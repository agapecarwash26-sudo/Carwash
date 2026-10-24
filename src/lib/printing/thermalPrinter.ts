export type PrintMethod = 'auto' | 'bluetooth' | 'browser' | 'gateway';

export interface PrintOptions {
  method?: PrintMethod;
  bluetoothName?: string;
  serviceUuid?: number | string;
  optionalServices?: Array<number | string>;
  characteristicUuid?: number | string;
  chunkSize?: number;
  browserHtml?: string;
  shareText?: string;
}


export function isIOSDevice(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroidDevice(): boolean {
  return /Android/i.test(navigator.userAgent);
}

async function shareOnIOS(title: string, text: string): Promise<boolean> {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch (error) {
    // User cancellation is not a printing failure.
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return false;
  }
}

function ensureBluetooth(): Bluetooth {
  const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
  if (!bluetooth) throw new Error('Web Bluetooth n’est pas disponible. Utilisez Chrome ou Edge en HTTPS.');
  return bluetooth;
}

export async function printP5_30D8(data: Uint8Array, options: PrintOptions = {}): Promise<void> {
  const bluetooth = ensureBluetooth();
  // Chrome exige que les services GATT qui seront lus soient déclarés ici.
  // Ces UUID couvrent plusieurs imprimantes thermiques Bluetooth courantes.
  // Pour une imprimante spécifique, renseignez serviceUuid dans l'appel.
  const optionalServices = options.optionalServices ?? [
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
  ];
  if (options.serviceUuid && !optionalServices.includes(options.serviceUuid)) {
    optionalServices.push(options.serviceUuid);
  }

  const device = await bluetooth.requestDevice({
    filters: [{ name: options.bluetoothName ?? 'P5_30D8' }],
    optionalServices,
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Connexion GATT impossible.');

  let services: BluetoothRemoteGATTService[] = [];
  if (options.serviceUuid) {
    services = [await server.getPrimaryService(options.serviceUuid)];
  } else {
    for (const uuid of optionalServices) {
      try {
        services.push(await server.getPrimaryService(uuid));
      } catch {
        // Le service n'existe pas sur cette imprimante : on essaie le suivant.
      }
    }
  }
  const service = services[0];
  if (!service) {
    throw new Error('Service Bluetooth introuvable. Renseignez le UUID du service de votre imprimante dans la configuration.');
  }

  const characteristics = options.characteristicUuid
    ? [await service.getCharacteristic(options.characteristicUuid)]
    : await service.getCharacteristics();
  const characteristic = characteristics.find(c => c.properties.writeWithoutResponse || c.properties.write) ?? characteristics[0];
  if (!characteristic) throw new Error('Caractéristique d’écriture introuvable.');

  // Les petites imprimantes thermiques perdent souvent des données lorsque
  // plusieurs centaines d'octets sont envoyés trop rapidement. On utilise
  // donc de petits paquets et une pause entre chaque écriture.
  const chunkSize = Math.min(Math.max(options.chunkSize ?? 64, 1), 128);
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, Math.min(offset + chunkSize, data.length));
    if (characteristic.properties.write && characteristic.writeValue) {
      await characteristic.writeValue(chunk);
    } else if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      throw new Error('La caractéristique Bluetooth ne permet pas l’écriture.');
    }
    await pause(35);
  }
  await pause(250);
  // Disconnect after the complete payload is accepted to prevent a printer
  // from keeping the GATT session open and repeating buffered data.
  try { device.gatt?.disconnect(); } catch { /* already disconnected */ }
}

export async function printWithBrowser(contentHtml: string, title = 'Impression'): Promise<void> {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) throw new Error('La fenêtre d’impression a été bloquée par le navigateur.');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${contentHtml}</body></html>`);
  win.document.close();
  await new Promise(resolve => setTimeout(resolve, 300));
  win.focus();
  win.print();
}

export async function printTicket(data: Uint8Array, options: PrintOptions = {}): Promise<void> {
  const method = options.method ?? 'auto';
  if (method === 'bluetooth') return printP5_30D8(data, options);
  if (method === 'browser') return printWithBrowser(options.browserHtml ?? new TextDecoder().decode(data));

  if (method === 'auto') {
    // iOS Safari/WebKit does not expose the Web Bluetooth API used by P5_30D8.
    // We therefore generate the same receipt content as a clean print-ready
    // page and hand it to the native iOS print/share sheet.
    if (isIOSDevice()) {
      if (options.browserHtml) {
        try {
          return await printWithBrowser(options.browserHtml);
        } catch {
          const shared = await shareOnIOS('Reçu AquaFlow', options.shareText ?? new TextDecoder().decode(data));
          if (shared) return;
          throw new Error('Impression iOS indisponible. Utilisez le partage natif ou AirPrint.');
        }
      }
      const shared = await shareOnIOS('Reçu AquaFlow', options.shareText ?? new TextDecoder().decode(data));
      if (shared) return;
      return printWithBrowser(new TextDecoder().decode(data));
    }
    return printP5_30D8(data, options);
  }

  throw new Error('La passerelle locale n’est pas encore configurée.');
}
