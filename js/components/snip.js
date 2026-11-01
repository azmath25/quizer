// Screenshot-and-crop tool. Resolves to a PNG File, or null if cancelled.
// Falls back to an image picker where screen capture is unavailable (phones).
function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function grabFrame() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    preferCurrentTab: true,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function crop(canvas) {
  return new Promise((resolve) => {
    const layer = document.createElement("div");
    layer.className = "snip-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-label", "Select an area to ask about");
    layer.innerHTML = `<p class="snip-hint">Drag to select an area · Esc to cancel</p><div class="snip-box" hidden></div>`;
    canvas.className = "snip-canvas";
    layer.prepend(canvas);
    document.body.append(layer);
    const box = layer.querySelector(".snip-box");
    let start = null,
      rect = null;
    const done = (value) => {
      removeEventListener("keydown", onKey);
      layer.remove();
      resolve(value);
    };
    const onKey = (ev) => ev.key === "Escape" && done(null);
    addEventListener("keydown", onKey);
    layer.onpointerdown = (ev) => {
      start = { x: ev.clientX, y: ev.clientY };
      layer.setPointerCapture(ev.pointerId);
      box.hidden = false;
    };
    layer.onpointermove = (ev) => {
      if (!start) return;
      rect = {
        x: Math.min(start.x, ev.clientX),
        y: Math.min(start.y, ev.clientY),
        w: Math.abs(ev.clientX - start.x),
        h: Math.abs(ev.clientY - start.y),
      };
      Object.assign(box.style, {
        left: rect.x + "px",
        top: rect.y + "px",
        width: rect.w + "px",
        height: rect.h + "px",
      });
    };
    layer.onpointerup = () => {
      if (!rect || rect.w < 8 || rect.h < 8) {
        start = rect = null;
        box.hidden = true;
        return;
      }
      const b = canvas.getBoundingClientRect(),
        sx = canvas.width / b.width,
        sy = canvas.height / b.height,
        out = document.createElement("canvas");
      out.width = Math.round(rect.w * sx);
      out.height = Math.round(rect.h * sy);
      out
        .getContext("2d")
        .drawImage(
          canvas,
          (rect.x - b.left) * sx,
          (rect.y - b.top) * sy,
          out.width,
          out.height,
          0,
          0,
          out.width,
          out.height,
        );
      out.toBlob(
        (blob) =>
          done(
            blob
              ? new File([blob], `snip-${Date.now()}.png`, {
                  type: "image/png",
                })
              : null,
          ),
        "image/png",
      );
    };
  });
}

export async function snip() {
  if (!navigator.mediaDevices?.getDisplayMedia) return pickImage();
  try {
    return await crop(await grabFrame());
  } catch (error) {
    if (error?.name === "NotAllowedError") return null;
    return pickImage();
  }
}
