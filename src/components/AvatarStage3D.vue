<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createIdleMotionController } from '../three/idleMotionController.js';

const props = defineProps({
  modelUrl: {
    type: String,
    default: '/models/avatar.vrm',
  },
  avatarStatus: {
    type: String,
    default: 'idle',
  },
});

const stageRef = ref(null);
const stageHint = ref('正在加载 VRM 模型...');
const DEFAULT_MODEL_SCALE_FACTOR = 1.4;
const modelScaleFactor = ref(DEFAULT_MODEL_SCALE_FACTOR);

let renderer;
let scene;
let camera;
let rootGroup;
let vrmInstance;
let baseModelScale = 1;
let frameId = 0;
let resizeObserver;
const timer = new THREE.Timer();
let isDragging = false;
let lastPointerX = 0;
let dragYaw = 0;
const facingOffset = Math.PI;
const lookAtTarget = new THREE.Vector3(0, 0.9, 0);
let idleController;
/** @type {string | null} */
let mouthDriverName = null;

/** VRM 嘴型预设优先级：aa 张嘴最明显 */
const MOUTH_DRIVER_PRIORITY = ['aa', 'oh', 'ou', 'ee', 'ih'];

function pickMouthDriverName(expressionManager) {
  if (!expressionManager) {
    return null;
  }
  for (const name of MOUTH_DRIVER_PRIORITY) {
    if (expressionManager.getExpression(name)) {
      return name;
    }
  }
  for (const expr of expressionManager.expressions) {
    const name = expr?.expressionName;
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (MOUTH_DRIVER_PRIORITY.includes(key)) {
      return name;
    }
  }
  return null;
}

/** 嘴型主频 ~1.35Hz、辅频 ~2Hz，接近日常对话开合节奏（原 13.5/20.1 rad/s 偏快） */
const MOUTH_SPEAK_OMEGA_PRIMARY = 8.5;
const MOUTH_SPEAK_OMEGA_SECONDARY = 12.6;

/**
 * speaking：多频正弦混合模拟开合；非说话：清零嘴型预设，避免与表情冲突。
 */
function applySpeakingMouthWeights(expressionManager, driverName, time, speaking) {
  if (!expressionManager || !driverName) {
    return;
  }
  const mouthNames = expressionManager.mouthExpressionNames;
  if (!speaking) {
    for (const n of mouthNames) {
      expressionManager.setValue(n, 0);
    }
    return;
  }
  for (const n of mouthNames) {
    if (n !== driverName) {
      expressionManager.setValue(n, 0);
    }
  }
  const t1 = time * MOUTH_SPEAK_OMEGA_PRIMARY;
  const t2 = time * MOUTH_SPEAK_OMEGA_SECONDARY + 1.1;
  const mix =
    0.62 * (0.5 + 0.5 * Math.sin(t1)) ** 0.92 + 0.38 * (0.5 + 0.5 * Math.sin(t2));
  const w = 0.26 + 0.74 * Math.min(1, Math.max(0, mix));
  expressionManager.setValue(driverName, w);
  if (driverName === 'aa' && expressionManager.getExpression('oh')) {
    expressionManager.setValue('oh', w * 0.38);
  }
}

const MIN_MODEL_SCALE = 0.6;
const MAX_MODEL_SCALE = 1.8;

function clampModelScale(value) {
  return Math.min(MAX_MODEL_SCALE, Math.max(MIN_MODEL_SCALE, value));
}

function applyModelScale() {
  if (!rootGroup) {
    return;
  }
  rootGroup.scale.setScalar(baseModelScale * modelScaleFactor.value);
  // 缩放后重新按包围盒居中，避免模型放大后偏移。
  centerModel(rootGroup);
}

function changeModelScale(step) {
  modelScaleFactor.value = clampModelScale(modelScaleFactor.value + step);
  applyModelScale();
}

function resetModelScale() {
  modelScaleFactor.value = DEFAULT_MODEL_SCALE_FACTOR;
  applyModelScale();
}

function buildPlaceholderAvatar() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2dd4bf,
    roughness: 0.32,
    metalness: 0.18,
  });

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x2dd4bf,
    emissiveIntensity: 0.08,
    roughness: 0.22,
    metalness: 0.28,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.4, 8, 16), bodyMaterial);
  body.position.y = 0.2;

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 24, 24), coreMaterial);
  core.position.set(0, 0.7, 0);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.04, 16, 80),
    new THREE.MeshStandardMaterial({ color: 0x99f6e4, roughness: 0.42, metalness: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2.2;
  ring.position.y = -0.15;

  group.scale.setScalar(1.35);
  group.add(body, core, ring);
  return group;
}

function resize() {
  if (!stageRef.value || !renderer || !camera) {
    return;
  }

  const { clientWidth, clientHeight } = stageRef.value;
  if (!clientWidth || !clientHeight) {
    return;
  }

  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  if (!rootGroup || !renderer || !scene || !camera) {
    return;
  }

  timer.update();
  const delta = timer.getDelta();
  const time = performance.now() * 0.001;
  if (!isDragging) {
    dragYaw += (0 - dragYaw) * 0.08;
  }

  const motionState =
    idleController?.update({ time, status: props.avatarStatus }) ?? {};
  rootGroup.rotation.y = facingOffset + dragYaw + (motionState.yawOffset ?? 0);
  camera.lookAt(lookAtTarget);

  applySpeakingMouthWeights(
    vrmInstance?.expressionManager,
    mouthDriverName,
    time,
    props.avatarStatus === 'speaking',
  );

  if (vrmInstance) {
    vrmInstance.update(delta);
  }

  renderer.render(scene, camera);
  frameId = requestAnimationFrame(animate);
}

function clampYaw(value) {
  const limit = Math.PI / 3;
  if (value > limit) {
    return limit;
  }
  if (value < -limit) {
    return -limit;
  }
  return value;
}

function centerModel(object3d) {
  if (!object3d) {
    return;
  }

  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  object3d.position.x -= center.x;
  object3d.position.z -= center.z;
  object3d.position.y += 0.9 - center.y;
}

function applyArmsDownPose(vrm) {
  // 先恢复模型默认标准姿态，再做小幅放松，避免出现异常抬手。
  vrm.humanoid?.resetNormalizedPose?.();

  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  const leftShoulder = vrm.humanoid?.getNormalizedBoneNode('leftShoulder');
  const rightShoulder = vrm.humanoid?.getNormalizedBoneNode('rightShoulder');

  // 轻微放松肩膀，让站姿更自然。
  leftShoulder?.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.08));
  rightShoulder?.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.08));

  // 上臂自然下垂，并保留小幅外展，避免贴身穿模。
  leftUpperArm?.quaternion.setFromEuler(new THREE.Euler(0, 0, 1.22));
  rightUpperArm?.quaternion.setFromEuler(new THREE.Euler(0, 0, -1.22));

  // 前臂略微弯曲，避免“僵硬直臂”。
  leftLowerArm?.quaternion.setFromEuler(new THREE.Euler(-0.12, 0, 0));
  rightLowerArm?.quaternion.setFromEuler(new THREE.Euler(-0.12, 0, 0));
}

function onPointerDown(event) {
  isDragging = true;
  lastPointerX = event.clientX;
}

function onPointerMove(event) {
  if (!isDragging) {
    return;
  }

  const deltaX = event.clientX - lastPointerX;
  lastPointerX = event.clientX;
  dragYaw = clampYaw(dragYaw + deltaX * 0.008);
}

function onPointerUp() {
  isDragging = false;
}

async function loadVRMAvatar() {
  const loader = new GLTFLoader();
  loader.crossOrigin = 'anonymous';
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(props.modelUrl);
  const vrm = gltf.userData.vrm;

  if (!vrm) {
    throw new Error('未检测到 VRM 数据。');
  }

  VRMUtils.rotateVRM0(vrm);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);

  vrm.scene.position.set(0, 0, 0);
  vrm.scene.scale.setScalar(2.1);
  applyArmsDownPose(vrm);
  centerModel(vrm.scene);

  vrmInstance = vrm;
  mouthDriverName = pickMouthDriverName(vrm.expressionManager);
  stageHint.value = '';
  return vrm.scene;
}

onMounted(async () => {
  const host = stageRef.value;
  if (!host) {
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#f7f7f8');

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.2, 4.4);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1);
  keyLight.position.set(3, 4, 4);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.5);
  fillLight.position.set(-3, 2, -2);
  scene.add(fillLight);

  try {
    rootGroup = await loadVRMAvatar();
  } catch (error) {
    mouthDriverName = null;
    rootGroup = buildPlaceholderAvatar();
    centerModel(rootGroup);
    stageHint.value = `VRM 加载失败，已使用占位模型：${error instanceof Error ? error.message : String(error)}`;
  }

  scene.add(rootGroup);
  baseModelScale = rootGroup.scale.x || 1;
  applyModelScale();
  idleController = createIdleMotionController();
  idleController.init({ root: rootGroup, vrm: vrmInstance });
  timer.reset();

  resize();
  animate();

  resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(host);

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointerleave', onPointerUp);
});

function setAvatarExpression(name, options) {
  return idleController?.setExpression(name, options) ?? false;
}

function triggerAvatarAction(id, options) {
  return idleController?.triggerAction(id, options) ?? false;
}

defineExpose({
  setAvatarExpression,
  triggerAvatarAction,
});

onBeforeUnmount(() => {
  if (frameId) {
    cancelAnimationFrame(frameId);
  }

  if (resizeObserver && stageRef.value) {
    resizeObserver.unobserve(stageRef.value);
  }

  if (stageRef.value) {
    stageRef.value.removeEventListener('pointerdown', onPointerDown);
    stageRef.value.removeEventListener('pointermove', onPointerMove);
    stageRef.value.removeEventListener('pointerup', onPointerUp);
    stageRef.value.removeEventListener('pointerleave', onPointerUp);
  }

  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
  }

  if (scene && rootGroup) {
    scene.remove(rootGroup);
  }

  renderer = undefined;
  scene = undefined;
  camera = undefined;
  rootGroup = undefined;
  vrmInstance = undefined;
  mouthDriverName = null;
  idleController?.dispose();
  idleController = undefined;
  isDragging = false;
  lastPointerX = 0;
  dragYaw = 0;
});
</script>

<template>
  <div ref="stageRef" class="avatar-stage-3d" aria-label="3D 数字人舞台">
    <div class="stage-scale-control">
      <button type="button" class="scale-btn" aria-label="缩小模型" @click="changeModelScale(-0.1)">-</button>
      <span class="scale-label">
        大小 {{ Math.round((modelScaleFactor / DEFAULT_MODEL_SCALE_FACTOR) * 100) }}%
      </span>
      <button type="button" class="scale-btn" aria-label="放大模型" @click="changeModelScale(0.1)">+</button>
      <button type="button" class="scale-reset-btn" @click="resetModelScale">重置</button>
    </div>
    <div v-if="stageHint" class="stage-hint">{{ stageHint }}</div>
  </div>
</template>

<style scoped>
.avatar-stage-3d {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  border-radius: 10px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.avatar-stage-3d:active {
  cursor: grabbing;
}

.stage-scale-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
}

.scale-btn,
.scale-reset-btn {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  border-radius: 6px;
  cursor: pointer;
}

.scale-btn {
  width: 26px;
  height: 26px;
  font-size: 16px;
  line-height: 1;
}

.scale-reset-btn {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}

.scale-label {
  min-width: 64px;
  font-size: 12px;
  color: #4b5563;
  text-align: center;
}

.stage-hint {
  position: absolute;
  z-index: 4;
  left: 12px;
  right: 12px;
  bottom: 12px;
  padding: 8px 10px;
  font-size: 12px;
  color: #6b7280;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
</style>
