# Phase 4: Media Generation

**Status:** ⏳ Pending
**Goal:** Local media generation, not just API passthrough

## Tasks

### 1. ComfyUI Integration
- `POST /api/media/image` — local image generation via ComfyUI API
- Supports: SD, SDXL, SD3, Flux
- Workflows: text-to-image, img2img, inpainting, outpainting, ControlNet
- API fallback when ComfyUI unavailable

### 2. Media Editing
- Image: crop, resize, filters, compositing
- Video: cut, merge, transitions, subtitles
- Pipeline UI: node-based editor

### 3. Audio
- TTS (ElevenLabs API or local Coqui/Whisper)
- STT for voice prompts
- Music generation (MusicGen/AudioCraft)

## Verification
- [ ] ComfyUI generates images locally
- [ ] API fallback works
- [ ] Image editing works
- [ ] Video editing works
- [ ] TTS generates audio
