import {
  $,
  button,
  n,
  box,
  api,
  sheet,
  error,
  withIcon,
  icon,
} from "./social-ui.js";
const max = 4 * 1024 * 1024;
const encode = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(Error("Could not read attachment."));
    r.readAsDataURL(blob);
  });
const close = () => $("#socialDialog").close();
// Show actual microphone levels, not a decorative animation. The recorder also works
// without Web Audio (or when the member has requested reduced motion).
function levels(stream) {
  const canvas = n("canvas", "dm-levels");
  canvas.setAttribute("aria-hidden", "true");
  if (
    !window.AudioContext ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.motion === "reduce"
  )
    return null;
  let ctx;
  try {
    ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream),
      meter = ctx.createAnalyser();
    meter.fftSize = 256;
    source.connect(meter);
    const values = new Uint8Array(meter.fftSize),
      bars = new Array(38).fill(1),
      g = canvas.getContext("2d");
    canvas.width = 228;
    canvas.height = 40;
    return {
      canvas,
      draw(paused) {
        if (paused) return;
        meter.getByteTimeDomainData(values);
        const peak = values.reduce((m, v) => Math.max(m, Math.abs(v - 128)), 0);
        bars.shift();
        bars.push(Math.max(2, Math.min(38, peak * 1.5)));
        g.clearRect(0, 0, 228, 40);
        g.fillStyle = getComputedStyle(canvas).color;
        bars.forEach((h, i) => g.fillRect(i * 6, (40 - h) / 2, 4, h));
      },
      close() {
        ctx.close().catch(() => {});
      },
    };
  } catch {
    ctx?.close().catch(() => {});
    return null;
  }
}
export function attachmentComposer(msg, send, dropZone) {
  const file = n("input"),
    preview = box("attachment dm-preview");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp,image/gif";
  file.hidden = preview.hidden = true;
  let selected = null,
    url = null,
    working = false,
    record = null,
    attempt = 0;
  function clear() {
    attempt++;
    selected = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    preview.hidden = true;
    preview.replaceChildren();
    msg.required = true;
    file.value = "";
    msg.placeholder = "Message…";
    msg.setAttribute("aria-label", msg.placeholder);
  }
  function display(blob, kind, data) {
    clear();
    url = URL.createObjectURL(blob);
    selected = { type: blob.type.split(";")[0], data, once: false };
    const audio = kind === "Voice note",
      el = n(audio ? "audio" : "img");
    el.src = url;
    if (audio) el.controls = true;
    else el.alt = "Selected " + kind;
    const remove = button(
      "Remove " + (audio ? "voice note" : kind === "GIF" ? "GIF" : "photo"),
      clear,
    );
    const size = n(
      "span",
      "dm-size",
      blob.size < 1024
        ? `${blob.size} B`
        : blob.size < 1024 * 1024
          ? `${(blob.size / 1024).toFixed(1)} KiB`
          : `${(blob.size / 1024 / 1024).toFixed(2)} MiB`,
    );
    size.title = `Attachment size: ${blob.size.toLocaleString()} bytes`;
    const kids = [el, n("strong", "", kind + " preview"), size];
    if (!audio) {
      const mode = box("dm-mode"),
        hint = n(
          "small",
          "subtle",
          "Screenshots are still possible. Your caption stays in chat.",
        );
      hint.hidden = true;
      for (const once of [false, true]) {
        const opt = button(once ? "View once" : "Keep in chat", () => {
          selected.once = once;
          hint.hidden = !once;
          for (const x of mode.children)
            x.setAttribute("aria-pressed", String(x === opt));
        });
        opt.setAttribute("aria-pressed", String(!once));
        mode.append(opt);
      }
      kids.push(mode, hint);
    }
    preview.replaceChildren(...kids, remove);
    preview.hidden = false;
    msg.required = false;
    msg.placeholder = "Add a caption…";
    msg.setAttribute("aria-label", msg.placeholder);
  }
  async function prepareImage(f) {
    if (!f || working || send.disabled) return;
    const seq = ++attempt;
    working = send.disabled = true;
    try {
      let blob = f,
        kind = f.type === "image/gif" ? "GIF" : "Photo";
      if (kind === "Photo") {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
          f.size > 8 * 1024 * 1024
        )
          throw Error("Choose a JPG, PNG or WebP under 8 MB.");
        const bmp = await createImageBitmap(f);
        try {
          const c = n("canvas"),
            scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
          c.width = Math.max(1, Math.round(bmp.width * scale));
          c.height = Math.max(1, Math.round(bmp.height * scale));
          c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
          blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
        } finally {
          bmp.close();
        }
      }
      if (!blob || blob.size > max)
        throw Error("Choose an attachment under 4 MB.");
      const data = await encode(blob);
      if (seq === attempt) display(blob, kind, data);
    } catch (e) {
      error(e);
    } finally {
      working = send.disabled = false;
    }
  }
  file.onchange = () => prepareImage(file.files[0]);
  function receive(files) {
    if (working || send.disabled)
      return error("Finish the current attachment first.");
    if (selected)
      return error("Remove the current attachment before adding another.");
    if (files.length !== 1) return error("Add one image at a time.");
    prepareImage(files[0]);
  }
  msg.addEventListener("paste", (e) => {
    const files = e.clipboardData?.files;
    if (!files?.length) return; // Leave ordinary text pastes to the browser.
    e.preventDefault();
    receive(files);
  });
  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes("Files");
  }
  dropZone.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    dropZone.classList.add("image-drop-target");
  });
  dropZone.addEventListener("dragleave", (e) => {
    if (!dropZone.contains(e.relatedTarget))
      dropZone.classList.remove("image-drop-target");
  });
  dropZone.addEventListener("drop", (e) => {
    dropZone.classList.remove("image-drop-target");
    if (!hasFiles(e)) return;
    e.preventDefault();
    receive(e.dataTransfer.files);
  });
  async function voice() {
    if (record || working) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw Error("Voice recording requires microphone support and HTTPS.");
    clear();
    const seq = attempt;
    working = send.disabled = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (seq !== attempt) {
        stream.getTracks().forEach((t) => t.stop());
        working = send.disabled = false;
        return;
      }
      const format = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((x) => MediaRecorder.isTypeSupported(x));
      if (!format) throw Error("No supported voice recording format.");
      const rec = new MediaRecorder(stream, {
        mimeType: format,
        audioBitsPerSecond: 48000,
      });
      record = rec;
      let chunks = [],
        cancel = false,
        length = 0;
      let start = performance.now(),
        duration = 0;
      const label = n("strong", "", "Recording · 0:00");
      rec.start(500);
      const meter = levels(stream);
      const tick = setInterval(() => {
        meter?.draw(rec.state === "paused");
        const sec = Math.floor(
          (duration +
            (rec.state === "paused" ? 0 : performance.now() - start)) /
            1000,
        );
        label.textContent = `${rec.state === "paused" ? "Paused" : "Recording"} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
        if (sec >= 120 && rec.state !== "inactive") rec.stop();
      }, 250);
      rec.ondataavailable = (e) => {
        length += e.data.size;
        chunks.push(e.data);
        if (length > max && rec.state !== "inactive") rec.stop();
      };
      rec.onstop = async () => {
        clearInterval(tick);
        meter?.close();
        stream.getTracks().forEach((t) => t.stop());
        record = null;
        try {
          if (seq !== attempt || cancel) return;
          const blob = new Blob(chunks, { type: format.split(";")[0] });
          if (!blob.size || blob.size > max)
            throw Error("Voice note is empty or too large.");
          const data = await encode(blob);
          if (seq === attempt) display(blob, "Voice note", data);
        } catch (e) {
          clear();
          error(e);
        } finally {
          working = send.disabled = false;
        }
      };
      rec.onerror = () => {
        cancel = true;
        clear();
        error("Recording failed.");
        if (rec.state !== "inactive") rec.stop();
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(tick);
        record = null;
        working = send.disabled = false;
      };
      preview.replaceChildren(
        label,
        ...(meter ? [meter.canvas] : []),
        button("Pause", (b) => {
          if (rec.state === "paused") {
            start = performance.now();
            rec.resume();
            b.textContent = "Pause";
          } else {
            duration += performance.now() - start;
            rec.pause();
            b.textContent = "Resume";
          }
        }),
        button("Finish", () => rec.stop()),
        button("Cancel", () => {
          cancel = true;
          rec.stop();
          clear();
        }),
      );
      preview.hidden = false;
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      working = send.disabled = false;
      throw e;
    }
  }
  const pick = withIcon(
    button("", () => {
      if (working || send.disabled) return;
      const tile = (label, key, fn) => {
        const b = button(label, fn);
        b.prepend(icon(key));
        return b;
      };
      const choose = (label, accept) =>
        tile(label, label === "GIF" ? "gif" : "photo", () => {
          close();
          file.accept = accept;
          file.click();
        });
      sheet(
        "Add to message",
        n(
          "p",
          "subtle",
          "Choose an attachment, paste an image into the message field, or drop an image into this chat. Nothing is sent until you press Send.",
        ),
        box(
          "dm-choices",
          choose("Photo", "image/jpeg,image/png,image/webp"),
          choose("GIF", "image/gif"),
          tile("Voice note", "mic", async () => {
            close();
            await voice();
          }),
        ),
      );
    }),
    "plus",
    "Add attachment",
  );
  addEventListener("pagehide", () => {
    clear();
    if (record && record.state !== "inactive") record.stop();
  });
  return {
    file,
    pick,
    preview,
    clear,
    get media() {
      return selected;
    },
    get working() {
      return working;
    },
  };
}
export function mediaBubble(m, sent) {
  const type = m.mediaType || (m.hasPhoto ? "image/jpeg" : null);
  if (!type) return null;
  const kind =
    type === "image/gif"
      ? "GIF"
      : type.startsWith("audio/")
        ? "Voice note"
        : "Photo";
  if (m.onceOnly) {
    const label = "View once · " + kind;
    const b = button(m.opened ? "Opened · " + kind : label, async () => {
      if (sent || m.opened) return;
      try {
        const r = await api(`/message-media/${m.id}/open`, {});
        m.opened = true;
        const data = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)),
          u = URL.createObjectURL(new Blob([data], { type: r.type })),
          img = n("img", "dm-expanded");
        img.alt = kind;
        img.src = u;
        sheet(
          label,
          img,
          n("p", "subtle", "This attachment cannot be opened again."),
        );
        const clean = () => {
          img.removeAttribute("src");
          URL.revokeObjectURL(u);
          removeEventListener("pagehide", leave);
        };
        const leave = () => {
          clean();
          close();
        };
        addEventListener("pagehide", leave, { once: true });
        $("#socialDialog").addEventListener("close", clean, { once: true });
        b.replaceWith(mediaBubble(m, sent));
      } catch (e) {
        if (e.status === 404) b.textContent = "Unavailable · " + kind;
        throw e;
      }
    });
    b.disabled = !!m.opened || sent;
    if (m.opened) b.dataset.opened = "1";
    b.className = "dm-once";
    return b;
  }
  const src =
    "/api/feed/" + (m.mediaType ? "message-media/" : "message-photo/") + m.id;
  if (kind === "Voice note") {
    const audio = n("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = src;
    const speed = n("select");
    for (const rate of [0.75, 1, 1.25, 1.5, 2])
      speed.add(new Option(`${rate}×`, String(rate)));
    speed.value = "1";
    speed.onchange = () => {
      audio.playbackRate = Number(speed.value);
    };
    audio.addEventListener("ratechange", () => {
      speed.value = String(audio.playbackRate);
    });
    const label = n("label", "dm-speed", "Voice note speed");
    label.append(speed);
    return box("dm-voice", n("strong", "", kind), audio, label);
  }
  const img = n("img", "message-photo");
  img.src = src;
  img.alt = kind + " in conversation";
  const b = button(
    "",
    () => {
      const full = n("img", "dm-expanded");
      full.src = src;
      full.alt = kind;
      sheet(kind, full, n("small", "subtle", "Kept in chat · can be reopened"));
    },
    "dm-image",
  );
  b.setAttribute("aria-label", "Expand " + kind);
  b.append(img);
  return b;
}
