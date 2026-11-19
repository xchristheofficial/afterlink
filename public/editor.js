const profileEditor = (() => {
  const el = (id) => document.getElementById(id);
  let api, timer, photo;
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
      const image = await createImageBitmap(file),
        size = Math.min(image.width, image.height),
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(
        image,
        (image.width - size) / 2,
        (image.height - size) / 2,
        size,
        size,
        0,
        0,
        256,
        256,
      );
      image.close();
      el("editAvatar").src = canvas.toDataURL("image/jpeg", 0.84);
      photo = el("editAvatar").src.split(",")[1];
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
        el("editPrivate").checked = !!p.private;
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
