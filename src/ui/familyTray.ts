import { circularCanvas, DEFAULT_FAMILY, type FamilyView } from '../scene/FamilyView';

const STORAGE_KEY = (i: number) => `family.v1.${i}`;

async function loadBitmap(src: Blob | string): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob);
}

/** Replacement photos persist per browser; storage may be unavailable, so every access is guarded. */
function readStored(i: number): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY(i));
  } catch {
    return null;
  }
}

function writeStored(i: number, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY(i));
    else localStorage.setItem(STORAGE_KEY(i), value);
  } catch {
    // Quota or privacy mode: the photo still applies for this session.
  }
}

/**
 * Three round thumbnails. Click one to replace that ball's photo with an image
 * from disk; the ↺ button restores the originals; the eye toggles the balls
 * (same as the F key) through `setVisible`.
 */
export function createFamilyTray(
  family: FamilyView,
  parent: HTMLElement,
  setVisible: (visible: boolean) => void,
) {
  const tray = document.createElement('div');
  tray.className = 'family-tray';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  let target = 0;

  const thumbs = DEFAULT_FAMILY.map((member, i) => {
    const b = document.createElement('button');
    b.className = 'family-thumb';
    b.title = `${member.name}: click to use your own photo`;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => {
      target = i;
      input.click();
    });
    tray.appendChild(b);
    return b;
  });

  const apply = (i: number, canvas: HTMLCanvasElement) => {
    family.setImage(i, canvas);
    thumbs[i]!.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
  };

  const loadDefault = async (i: number) => apply(i, circularCanvas(await loadBitmap(DEFAULT_FAMILY[i]!.url)));

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const canvas = circularCanvas(await loadBitmap(file));
    apply(target, canvas);
    writeStored(target, canvas.toDataURL('image/png'));
  });

  const reset = document.createElement('button');
  reset.className = 'family-btn';
  reset.textContent = '↺';
  reset.title = 'Restore the original photos';
  reset.addEventListener('click', () => {
    DEFAULT_FAMILY.forEach((_, i) => {
      writeStored(i, null);
      void loadDefault(i);
    });
  });

  const eye = document.createElement('button');
  eye.className = 'family-btn';
  const syncEye = () => {
    eye.textContent = family.visible ? '◉' : '○';
    // Say what a click will do, not both options.
    eye.title = `${family.visible ? 'Hide' : 'Show'} the photo balls (F)`;
    eye.setAttribute('aria-label', eye.title);
    tray.classList.toggle('off', !family.visible);
  };
  eye.addEventListener('click', () => {
    setVisible(!family.visible);
    syncEye();
  });

  tray.append(reset, eye, input);
  // Mouse/touch clicks shouldn't leave focus on a button, or Space (pause)
  // would also re-click it. Keyboard focus via Tab is unaffected.
  tray.addEventListener('pointerup', (e) => (e.target as HTMLElement).blur());
  parent.appendChild(tray);
  syncEye();

  DEFAULT_FAMILY.forEach((_, i) => {
    const stored = readStored(i);
    const load = stored
      ? loadBitmap(stored).then((bmp) => apply(i, circularCanvas(bmp)))
      : loadDefault(i);
    load.catch(() => loadDefault(i));
  });

  return {
    element: tray,
    /** Call after family.visible changes elsewhere (keyboard, panel). */
    refresh: syncEye,
  };
}
