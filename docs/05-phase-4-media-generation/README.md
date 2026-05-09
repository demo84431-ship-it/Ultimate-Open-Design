# Phase 4: Media Generation

**Status:** ⏳ Pending
**Goal:** Local media generation, not just API passthrough
**Estimated Effort:** 2 weeks

---

## Overview

Currently 96 prompt templates call external APIs. This phase adds local generation capabilities.

---

## Agent Tasks

### Agent 1: P4-comfyui — ComfyUI Integration

**Output:** `apps/daemon/src/media/comfyui.ts`

Features:
- ComfyUI API client for local image generation
- Supports: SD, SDXL, SD3, Flux models
- Workflow templates:
  - Text-to-image
  - Image-to-image
  - Inpainting (mask-based editing)
  - Outpainting (extend canvas)
  - ControlNet (guided generation with pose/depth/canny)
- Fallback to gpt-image-2 API when ComfyUI unavailable
- Progress streaming via SSE

Daemon endpoint:
```
POST /api/media/image
Body: { prompt: string, model?: string, workflow?: string, ... }
Response: { taskId: string, status: "processing" }
GET /api/media/image/:taskId/status
Response: { status: "completed", url: string }
```

**Verification:** Generates an image locally (when ComfyUI available). Falls back to API when not.

### Agent 2: P4-media-editing — Image/Video Editing

**Output:** `apps/daemon/src/media/edit.ts`

Image editing:
- Crop, resize, rotate
- Filters (brightness, contrast, saturation, blur)
- Compositing (overlay, blend modes)
- Format conversion (PNG, JPG, WebP)

Video editing:
- Cut, trim, merge clips
- Add transitions (fade, dissolve, slide)
- Add subtitles/captions
- Extract frames
- Format conversion (MP4, GIF, WebM)

**Verification:** Crop an image. Merge two video clips.

### Agent 3: P4-audio — TTS/STT Integration

**Output:** `apps/daemon/src/media/audio.ts`

Features:
- TTS: ElevenLabs API or local Coqui/XTTS
- STT: Whisper for voice prompts
- Music generation: MusicGen/AudioCraft integration
- Audio jingle skill enhancement
- Video narration capability

**Verification:** Generate a spoken audio file from text.

---

## Verification Criteria

- [ ] ComfyUI generates images locally (when available)
- [ ] API fallback works when ComfyUI unavailable
- [ ] Image editing operations work
- [ ] Video editing pipeline functional
- [ ] TTS generates audio files
- [ ] All 96 prompt templates still work

---

## Commit Message

```
feat(phase-4): media generation — ComfyUI, image/video editing, TTS/STT
```
