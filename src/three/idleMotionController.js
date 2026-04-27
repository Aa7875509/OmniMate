import * as THREE from 'three';

export function createIdleMotionController() {
  /**
   * 表情预设（供后期大模型调用）
   * - neutral: 中性
   * - happy: 轻松愉快
   * - focus: 专注思考
   * - curious: 好奇偏头
   * - calm: 平静低振幅
   */
  const EXPRESSION_PRESETS = {
    neutral: { breatheMul: 1, swayMul: 1, neckYawBias: 0, neckPitchBias: 0, chestRollBias: 0 },
    happy: { breatheMul: 1.1, swayMul: 1.15, neckYawBias: 0.04, neckPitchBias: 0.02, chestRollBias: 0.02 },
    focus: { breatheMul: 0.85, swayMul: 0.7, neckYawBias: 0, neckPitchBias: -0.01, chestRollBias: 0 },
    curious: { breatheMul: 1, swayMul: 0.95, neckYawBias: 0.08, neckPitchBias: 0.01, chestRollBias: 0.05 },
    calm: { breatheMul: 0.8, swayMul: 0.8, neckYawBias: 0, neckPitchBias: 0, chestRollBias: 0 },
  };

  /**
   * 动作预设（供后期大模型调用）
   * - nod_once: 点头一次
   * - glance_left: 向左看
   * - glance_right: 向右看
   * - acknowledge: 轻确认动作
   * - idle_shift: 重心偏移
   * - speak: 说话节奏动作（头/胸轻微点动）
   * - jump: 跳跃一次
   * - wave: 招手
   * - spin: 原地转圈
   */
  const ACTION_PRESETS = {
    nod_once: { duration: 1.0, mode: 'nod', intensity: 1 },
    glance_left: { duration: 1.2, mode: 'glance_left', intensity: 1 },
    glance_right: { duration: 1.2, mode: 'glance_right', intensity: 1 },
    acknowledge: { duration: 1.1, mode: 'ack', intensity: 1 },
    idle_shift: { duration: 1.3, mode: 'shift', intensity: 1 },
    speak: { duration: 1.6, mode: 'speak', intensity: 1, beat: 8 },
    jump: { duration: 1.2, mode: 'jump', intensity: 1 },
    wave: { duration: 1.8, mode: 'wave', intensity: 1, beat: 5 },
    spin: { duration: 1.4, mode: 'spin', intensity: 1 },
  };

  let modelRoot;
  let baseRootY = 0;
  let chestBone;
  let neckBone;
  let headBone;
  let leftUpperArm;
  let rightUpperArm;
  let leftLowerArm;
  let rightLowerArm;
  let chestRest;
  let neckRest;
  let headRest;
  let leftUpperArmRest;
  let rightUpperArmRest;
  let leftLowerArmRest;
  let rightLowerArmRest;
  let nextAccentAt = 0;
  let currentAction = null;
  let queuedAction = null;
  let activeExpression = { name: 'neutral', intensity: 1, until: -1 };

  function scheduleNextAccent(nowSeconds) {
    const minGap = 4.5;
    const maxGap = 9.5;
    nextAccentAt = nowSeconds + minGap + Math.random() * (maxGap - minGap);
  }

  function init({ root, vrm }) {
    modelRoot = root;
    baseRootY = root?.position.y ?? 0;

    chestBone = vrm?.humanoid?.getNormalizedBoneNode('chest');
    neckBone = vrm?.humanoid?.getNormalizedBoneNode('neck');
    headBone = vrm?.humanoid?.getNormalizedBoneNode('head');
    leftUpperArm = vrm?.humanoid?.getNormalizedBoneNode('leftUpperArm');
    rightUpperArm = vrm?.humanoid?.getNormalizedBoneNode('rightUpperArm');
    leftLowerArm = vrm?.humanoid?.getNormalizedBoneNode('leftLowerArm');
    rightLowerArm = vrm?.humanoid?.getNormalizedBoneNode('rightLowerArm');
    chestRest = chestBone?.quaternion.clone();
    neckRest = neckBone?.quaternion.clone();
    headRest = headBone?.quaternion.clone();
    leftUpperArmRest = leftUpperArm?.quaternion.clone();
    rightUpperArmRest = rightUpperArm?.quaternion.clone();
    leftLowerArmRest = leftLowerArm?.quaternion.clone();
    rightLowerArmRest = rightLowerArm?.quaternion.clone();
    scheduleNextAccent(0);
  }

  function applyBoneOffset(bone, restQuaternion, offsetEuler, smoothing) {
    if (!bone || !restQuaternion) {
      return;
    }
    const deltaQuaternion = new THREE.Quaternion().setFromEuler(offsetEuler);
    const targetQuaternion = restQuaternion.clone().multiply(deltaQuaternion);
    bone.quaternion.slerp(targetQuaternion, smoothing);
  }

  function update({ time, status }) {
    if (!modelRoot) {
      return;
    }

    if (activeExpression.until > 0 && time >= activeExpression.until) {
      activeExpression = { name: 'neutral', intensity: 1, until: -1 };
    }

    const expressionConfig =
      EXPRESSION_PRESETS[activeExpression.name] ?? EXPRESSION_PRESETS.neutral;

    const isThinking = status === 'thinking';
    const isSpeaking = status === 'speaking';
    const isIdle = status === 'idle';
    // 思考中：比 idle/说话略强的全身微动，便于辨识「在琢磨」
    const statusIntensity = isThinking ? 1.65 : isSpeaking ? 1.05 : 0.7;
    const expressionIntensity = Math.max(0.1, activeExpression.intensity ?? 1);
    const intensity = statusIntensity * expressionIntensity;
    // 说话时略慢于原先，贴近真人讲话时躯干/头颈的微动频率
    const breatheSpeed = isThinking ? 2.2 : isSpeaking ? 1.15 : 1.4;
    const swaySpeed = isThinking ? 1.85 : isSpeaking ? 0.95 : 1.0;

    const breatheOffset =
      Math.sin(time * breatheSpeed) * 0.02 * intensity * expressionConfig.breatheMul;
    const sideShift =
      Math.sin(time * (swaySpeed * 0.8)) * 0.015 * intensity * expressionConfig.swayMul;
    modelRoot.position.y = baseRootY + breatheOffset;
    modelRoot.position.x = sideShift;

    let chestPitch = Math.sin(time * swaySpeed) * 0.05 * intensity;
    let chestRoll = Math.sin(time * (swaySpeed * 0.7)) * 0.03 * intensity + expressionConfig.chestRollBias;
    let neckPitch = Math.sin(time * (swaySpeed * 1.2)) * 0.025 * intensity + expressionConfig.neckPitchBias;
    let neckYaw = Math.sin(time * (swaySpeed * 0.9)) * 0.03 * intensity + expressionConfig.neckYawBias;
    let headPitch = 0;
    let headYaw = 0;
    let headRoll = 0;
    let leftUpperArmEuler = new THREE.Euler(0, 0, 0);
    let rightUpperArmEuler = new THREE.Euler(0, 0, 0);
    let leftLowerArmEuler = new THREE.Euler(0, 0, 0);
    let rightLowerArmEuler = new THREE.Euler(0, 0, 0);
    let rootYawOffset = 0;

    // 仅在 idle 状态随机触发一次短时动作
    if (isIdle) {
      if (time >= nextAccentAt && !currentAction && !queuedAction) {
        const id = Math.random() > 0.5 ? 'nod_once' : 'glance_left';
        queuedAction = { id, options: {} };
      }
    }

    if (!currentAction && queuedAction) {
      const preset = ACTION_PRESETS[queuedAction.id];
      if (preset) {
        const merged = { ...preset, ...(queuedAction.options ?? {}) };
        currentAction = {
          id: queuedAction.id,
          mode: merged.mode,
          startAt: time,
          duration: merged.duration,
          intensity: merged.intensity ?? 1,
          beat: merged.beat ?? 4,
        };
      }
      queuedAction = null;
    }

    if (currentAction) {
      const progress = (time - currentAction.startAt) / currentAction.duration;
      if (progress >= 1) {
        currentAction = null;
        scheduleNextAccent(time);
      } else {
        const envelope = Math.sin(progress * Math.PI);
        const actIntensity = Math.max(0.2, currentAction.intensity ?? 1);
        if (currentAction.mode === 'nod') {
          neckPitch += envelope * 0.22 * actIntensity;
          chestPitch += envelope * 0.08 * actIntensity;
          headPitch += envelope * 0.1 * actIntensity;
        } else if (currentAction.mode === 'glance_left') {
          neckYaw += envelope * 0.26 * actIntensity;
          headYaw += envelope * 0.2 * actIntensity;
          chestRoll += envelope * 0.08 * actIntensity;
        } else if (currentAction.mode === 'glance_right') {
          neckYaw -= envelope * 0.26 * actIntensity;
          headYaw -= envelope * 0.2 * actIntensity;
          chestRoll -= envelope * 0.08 * actIntensity;
        } else if (currentAction.mode === 'ack') {
          neckPitch += envelope * 0.16 * actIntensity;
          headPitch += envelope * 0.08 * actIntensity;
          headRoll += envelope * 0.06 * actIntensity;
        } else if (currentAction.mode === 'shift') {
          modelRoot.position.x += envelope * 0.03 * actIntensity;
        } else if (currentAction.mode === 'speak') {
          const beat = Math.sin(progress * Math.PI * currentAction.beat) * envelope;
          neckPitch += beat * 0.08 * actIntensity;
          chestPitch += beat * 0.05 * actIntensity;
          headPitch += beat * 0.05 * actIntensity;
        } else if (currentAction.mode === 'jump') {
          const jumpArc = Math.sin(progress * Math.PI);
          modelRoot.position.y += jumpArc * 0.26 * actIntensity;
          chestPitch -= jumpArc * 0.06 * actIntensity;
        } else if (currentAction.mode === 'wave') {
          const beat = Math.sin(progress * Math.PI * currentAction.beat) * envelope;
          rightUpperArmEuler = new THREE.Euler(-0.9, 0, -0.45);
          rightLowerArmEuler = new THREE.Euler(-0.3 + beat * 0.5 * actIntensity, 0, 0);
          headYaw -= envelope * 0.08 * actIntensity;
        } else if (currentAction.mode === 'spin') {
          rootYawOffset = progress * Math.PI * 2 * actIntensity;
          chestRoll += Math.sin(progress * Math.PI * 2) * 0.03 * actIntensity;
        }
      }
    }

    // 嘴型由 VRM expression 驱动；此处仅保留很轻的头颈节奏，避免只剩「点头」抢戏。
    if (isSpeaking) {
      const beat = Math.sin(time * 11.5) * 0.32;
      neckPitch += beat * 0.035;
      chestPitch += beat * 0.022;
      headPitch += beat * 0.022;
    }

    applyBoneOffset(chestBone, chestRest, new THREE.Euler(chestPitch, 0, chestRoll), 0.08);
    applyBoneOffset(neckBone, neckRest, new THREE.Euler(neckPitch, neckYaw, 0), 0.1);
    applyBoneOffset(headBone, headRest, new THREE.Euler(headPitch, headYaw, headRoll), 0.12);
    applyBoneOffset(leftUpperArm, leftUpperArmRest, leftUpperArmEuler, 0.12);
    applyBoneOffset(rightUpperArm, rightUpperArmRest, rightUpperArmEuler, 0.12);
    applyBoneOffset(leftLowerArm, leftLowerArmRest, leftLowerArmEuler, 0.12);
    applyBoneOffset(rightLowerArm, rightLowerArmRest, rightLowerArmEuler, 0.12);

    return { yawOffset: rootYawOffset };
  }

  // 外部可调用：设置表情（可指定持续时间秒）
  function setExpression(name, options = {}) {
    if (!EXPRESSION_PRESETS[name]) {
      return false;
    }
    const duration = typeof options.duration === 'number' ? options.duration : -1;
    const intensity = typeof options.intensity === 'number' ? options.intensity : 1;
    activeExpression = {
      name,
      intensity,
      until: duration > 0 ? performance.now() * 0.001 + duration : -1,
    };
    return true;
  }

  // 外部可调用：触发动作（排队执行）
  function triggerAction(id, options = {}) {
    if (!ACTION_PRESETS[id]) {
      return false;
    }
    const interrupt = Boolean(options.interrupt);
    if (interrupt) {
      currentAction = null;
    }
    queuedAction = { id, options };
    return true;
  }

  function listAvailableExpressions() {
    return Object.keys(EXPRESSION_PRESETS);
  }

  function listAvailableActions() {
    return Object.keys(ACTION_PRESETS);
  }

  function dispose() {
    modelRoot = undefined;
    chestBone = undefined;
    neckBone = undefined;
    headBone = undefined;
    leftUpperArm = undefined;
    rightUpperArm = undefined;
    leftLowerArm = undefined;
    rightLowerArm = undefined;
    chestRest = undefined;
    neckRest = undefined;
    headRest = undefined;
    leftUpperArmRest = undefined;
    rightUpperArmRest = undefined;
    leftLowerArmRest = undefined;
    rightLowerArmRest = undefined;
    baseRootY = 0;
    nextAccentAt = 0;
    currentAction = null;
    queuedAction = null;
    activeExpression = { name: 'neutral', intensity: 1, until: -1 };
  }

  return {
    init,
    update,
    dispose,
    setExpression,
    triggerAction,
    listAvailableExpressions,
    listAvailableActions,
  };
}
