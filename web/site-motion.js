(() => {
  const main = document.querySelector('main');
  const doll = document.querySelector('#cursor-doll');
  const tiffanyUrl = new URL('tiffany.png', document.currentScript.src);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let x = 0, y = 0, targetX = 0, targetY = 0, frame = 0;
  let heading = 1, previousPointer = null;
  let lastFrameTime = 0;

  function hideDoll() {
    doll.classList.remove("visible");
    previousPointer = null;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function followFrame(now) {
    const amount = 1 - Math.exp(-Math.min(now - lastFrameTime, 48) / 105);
    lastFrameTime = now;
    x += (targetX - x) * amount;
    y += (targetY - y) * amount;
    const moving = Math.hypot(targetX - x, targetY - y) > 0.35;
    doll.style.translate = (moving ? x : targetX) + "px " + (moving ? y : targetY) + "px";
    frame = moving ? requestAnimationFrame(followFrame) : 0;
  }

  document.addEventListener("pointermove", event => {
    if (reduced.matches || event.pointerType !== "mouse") return;
    const { clientX, clientY } = event;
    const firstMovement = previousPointer === null;
    if (firstMovement) {
      previousPointer = clientX;
    } else if ((clientX - previousPointer) * heading < -6) {
      heading *= -1;
      previousPointer = clientX;
    } else if ((clientX - previousPointer) * heading > 0) {
      previousPointer = clientX;
    }
    doll.dataset.direction = heading < 0 ? "left" : "right";

    const width = doll.offsetWidth;
    const height = doll.offsetHeight;
    const offset = heading < 0 ? 13 : -width - 13;
    targetX = Math.max(4, Math.min(innerWidth - width - 4, clientX + offset));
    targetY = Math.max(4, Math.min(innerHeight - height - 4, clientY + 16));
    if (firstMovement) {
      x = targetX;
      y = targetY;
      doll.style.translate = x + "px " + y + "px";
      doll.classList.add("visible");
    }
    if (!frame) {
      lastFrameTime = performance.now();
      frame = requestAnimationFrame(followFrame);
    }
  });
  document.documentElement.addEventListener("pointerleave", hideDoll);
  window.addEventListener("blur", hideDoll);
  reduced.addEventListener("change", hideDoll);


  const headings = 'h1,h2,h3,h4';
  let currentSprite;

  function showPeek(target) {
    const title = target.closest(headings) || target.querySelector(headings) ||
      target.closest('section')?.querySelector(headings) || main.querySelector('header h1');
    if (!title) return;

    currentSprite?.remove();
    let row = title.parentElement;
    if (!row.classList.contains('motion-heading')) {
      row = document.createElement('div');
      row.className = 'motion-heading';
      title.before(row);
      row.append(title);
    }
    const slot = document.createElement('span');
    slot.className = 'tiffany-peek';
    slot.setAttribute('aria-hidden', 'true');
    const sprite = new Image(120, 95);
    sprite.alt = '';
    sprite.draggable = false;
    sprite.src = tiffanyUrl.href;
    slot.append(sprite);
    row.append(slot);
    currentSprite = slot;
    sprite.addEventListener('animationend', () => slot.remove(), { once: true });
    sprite.addEventListener('error', () => slot.remove(), { once: true });
  }

  function showDestination() {
    if (location.hash === '#page-top') return;
    if (!location.hash) {
      const header = main.querySelector('.detail-header');
      if (header) showPeek(header);
      return;
    }
    let anchor;
    try {
      anchor = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch {
      return;
    }
    if (anchor && main.contains(anchor)) showPeek(anchor);
  }

  window.addEventListener('hashchange', showDestination);
  main.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link?.hash && link.hash === location.hash &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      showDestination();
    }
  });
  showDestination();
})();
