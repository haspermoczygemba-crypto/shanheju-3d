/**
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Adapted 2026-10-07 from AionUi 6744099b279b991c17e31c243f0920477bd31cb6,
 * Preview/context/previewScope.ts. Conversation scope replaces the shared
 * workspace fallback; file authorization remains entirely server-side.
 */
export function previewScopeKey(projectId, conversationId) {
  if (projectId) return `project:${projectId}`;
  return conversationId ? `conversation:${conversationId}` : null;
}
