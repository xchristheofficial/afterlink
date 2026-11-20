const profileEditor = (() => {
  const el = (id) => document.getElementById(id);
  let api, timer, photo, wasPrivate;
  let crops = [];
  function previewCrop() {
    const url = crops[el("photoFocus").selectedIndex];
    if (!url) return;
    el("editAvatar").src = url;
    photo = url.split(",")[1];
  }
  el("photoFocus").onchange = previewCrop;
  el("undoPhoto").onclick = () => {
    crops = [];
    photo = undefined;
    el("editAvatar").src = "/api/feed/avatar/me";
    el("photoAdjust").hidden = true;
    el("pickPhoto").focus();
  };
  const privateNote = () => {
    el("privacyNote").hidden = !el("editPrivate").checked;
  };
  el("editPrivate").onchange = privateNote;
  function state(label, ok = false) {
    el("handleState").textContent = label;
    el("handleState").classList.toggle("available", ok);
  }
  el("editUsername").oninput = () => {
    clearTimeout(timer);
    const input = el("editUsername"),
      value = input.value;
    input.setCustomValidity("");
    if (!input.validity.valid) {
      state("3–30 characters");
      return;
    }
    state("Checking…");
    timer = setTimeout(async () => {
      try {
        const { available } = await api(
          "/username?name=" + encodeURIComponent(value),
        );
        if (input.value !== value) return;
        state(available ? "✓ Available" : "Taken", available);
        input.setCustomValidity(
          available ? "" : "That username is already taken.",
        );
      } catch {
        if (input.value === value) state("Check on save");
      }
    }, 250);
  };
  el("pickPhoto").onclick = () => el("photoFile").click();
  el("photoFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    el("editSave").disabled = el("pickPhoto").disabled = true;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8 * 1024 * 1024
      )
        throw Error("Choose a JPG, PNG or WebP under 8 MB.");
      const image = await createImageBitmap(file);
      try {
        const size = Math.min(image.width, image.height),
          canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d"),
          square = image.width === image.height;
        const labels = square
          ? ["Center"]
          : image.width > image.height
            ? ["Left", "Center", "Right"]
            : ["Top", "Center", "Bottom"];
        crops = labels.map((_, i) => {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, 256, 256);
          ctx.drawImage(
            image,
            ((image.width - size) * i) / 2,
            ((image.height - size) * i) / 2,
            size,
            size,
            0,
            0,
            256,
            256,
          );
          return canvas.toDataURL("image/jpeg", 0.84);
        });
        const focus = el("photoFocus");
        focus.replaceChildren(...labels.map((l) => new Option(l, l)));
        focus.value = "Center";
        focus.hidden = el("photoFocusLabel").hidden = square;
        el("photoAdjust").hidden = false;
        previewCrop();
      } finally {
        image.close();
      }
      el("editError").textContent = "";
    } catch (err) {
      el("editError").textContent = err.message;
    } finally {
      el("editSave").disabled = el("pickPhoto").disabled = false;
      event.target.value = "";
    }
  };
  el("editForm").onsubmit = async (event) => {
    event.preventDefault();
    if (el("editSave").disabled) return;
    el("editSave").disabled = true;
    try {
      if (wasPrivate && !el("editPrivate").checked) {
        const { confirmPublicProfile } = await import("./privacy-review.js");
        if (!(await confirmPublicProfile())) {
          el("editPrivate").checked = true;
          privateNote();
          el("editSave").disabled = false;
          el("editPrivate").focus();
          return;
        }
      }
      await api("/profile", {
        name: el("editName").value,
        username: el("editUsername").value,
        bio: el("editBio").value,
        phone: el("editPhone").value,
        private: el("editPrivate").checked,
        photo,
      });
      location.assign("/profile");
    } catch (err) {
      el("editError").textContent = err.message;
      el("editSave").disabled = false;
    }
  };
  el("deleteAccount").onclick = () => {
    el("deleteText").value = "";
    el("deleteError").textContent = "";
    el("deleteDialog").showModal();
  };
  el("keepAccount").onclick = () => el("deleteDialog").close();
  el("deleteForm").onsubmit = async (event) => {
    event.preventDefault();
    el("confirmDelete").disabled = true;
    try {
      await api("/delete-account", { confirmation: el("deleteText").value });
      location.replace("/");
    } catch (err) {
      el("deleteError").textContent = err.message;
      el("confirmDelete").disabled = false;
    }
  };
  return {
    async open(service) {
      api = service;
      document.title = "Edit Profile · AfterLink";
      el("account").classList.add("compact-editor");

      el("memberPage").hidden = true;
      el("editMember").hidden = false;
      try {
        const { profile: p, contact } = await api("/profile");
        el("editName").value = p.name;
        el("editName").readOnly = !!p.founder;
        el("badgeNote").hidden = !p.founder;
        el("editUsername").value = p.username || "";
        state(p.username ? "✓ Available" : "", !!p.username);
        el("editBio").value = p.bio;
        el("editPhone").value = contact.phone || "";
        el("editEmail").value = contact.email;
        wasPrivate = el("editPrivate").checked = !!p.private;
        privateNote();
        el("editAvatar").src = "/api/feed/avatar/me";
        el("editForm").hidden = false;
        el("editLoading").hidden = true;
      } catch (err) {
        el("editLoading").textContent = err.message;
      }
    },
  };
})();
