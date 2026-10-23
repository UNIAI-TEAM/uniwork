# UniWork horse illustration

The user supplied a horse appearance reference and explicitly chose a polished
AI illustration with web motion instead of a 360-degree rigged model. Its source
name, typography and chest symbol are not part of the UniWork identity.

- Active artwork: `apps/web/public/landing/mascot/uni-horse-v2.webp` (190,390 bytes). The historical `uni-horse-v2-blink.webp` is preserved but no longer loaded.
- Exact prompts: `v2.prompt.txt` and `v2-blink.prompt.txt`.
- Masters: `uni-horse-v2-master.png` and `uni-horse-v2-blink-master.png`, outside public assets.
- Provenance and checksums: matching `.webp.json` sidecars. Run `node scripts/landing-mascot/prepare-v2.mjs` to reproduce optimization.
- Earlier master and prompts are historical; the page no longer loads the first version.
- Tool: built-in imagegen, not an image-to-3D or video-generation service.

The original artwork is the source of truth. After the user rejected an
approximate procedural 3D model, `features/landing/animation/mascot-renderer.ts`
was restored to the exact approved image. A small 2.5D foreleg wave uses a
bounded mask that excludes the face and mane; the body and tail also stay
unchanged. No blink frame, head turn, recoloring or synthetic lighting is used.
Pause restores the original pose. The same transparent image remains available
without WebGL. Reduced motion starts paused; animation stops offscreen, in a
hidden document, or when manually paused.

The logo is never generated into the artwork. The page uses the shared `Logo`
component in its normal proportions and orientation. The hero core also uses
this component, above original supporting geometry, without rotating the mark.

## Motion research and adaptation

The public [MotionSites 3D lesson](https://motionsites.ai/lesson/build-3d-scroll-animated-website-with-ai)
separates reference creation, asset production, and runtime choreography. Its
full-model method uses a GLB; this implementation deliberately takes the
user-approved illustration route instead. The public
[MotionSite Interactive Hero gallery](https://www.motionsite.ai/category/interactive-media)
was inspected, but its Copy Prompt control returned no prompt in this session.
No paid prompt, third-party media, or private library content was copied.

The motion direction here is original: a still, accurate brand anchors the hero
while detailed work objects and context signals move around it; the horse
responds gently to attention and greetings; the film explains conversation
becoming shared context. Legibility and local product controls remain primary.
