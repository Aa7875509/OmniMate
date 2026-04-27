import './avatarBehaviorRuleConfig.js';

export function executeAvatarBehaviorFromReply({ avatar, text }) {
  if (!avatar || typeof text !== 'string' || !text.trim()) {
    return;
  }
  avatar.setAvatarExpression?.('happy', { duration: 2.2, intensity: 0.95 });
  avatar.triggerAvatarAction?.('acknowledge', { interrupt: true });
}
