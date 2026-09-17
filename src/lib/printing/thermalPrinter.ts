export type PrintMethod = 'bluetooth' | 'browser' | 'gateway';

export interface PrintOptions {
  method?: PrintMethod;
  bluetoothName?: string;
  serviceUuid?: number | string;
  characteristicUuid?: number | string;
  chunkSize?: number;
}

function ensureBluetooth(): Bluetooth {
  const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
  if (!bluetooth) throw new Error('Web Bluetooth n’est pas disponible. Utilisez Chrome ou Edge en HTTPS.');
  return bluetooth;
}

export async function printP5_30D8(data: Uint8Array, options: PrintOptions = {}): Promise<void> {
  const bluetooth = ensureBluetooth();
  const device = await bluetooth.requestDevice({
    filters: [{ name: options.bluetoothName ?? 'P5_30D8' }],
    optionalServices: options.serviceUuid ? [options.serviceUuid] : undefined,
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Connexion GATT impossible.');

  const services = options.serviceUuid
    ? [await server.getPrimaryService(options.serviceUuid)]
    : await server.getPrimaryServices();
  const service = services[0];
  if (!service) throw new Error('Service Bluetooth introuvable.');

  const characteristics = options.characteristicUuid
    ? [await service.getCharacteristic(options.characteristicUuid)]
    : await service.getCharacteristics();
  const characteristic = characteristics.find(c => c.properties.writeWithoutResponse || c.properties.write) ?? characteristics[0];
  if (!characteristic) throw new Error('Caractéristique d’écriture introuvable.');

  const chunkSize = Math.min(Math.max(options.chunkSize ?? 512, 1), 512);
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, Math.min(offset + chunkSize, data.length));
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
  }
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
  if ((options.method ?? 'bluetooth') === 'bluetooth') return printP5_30D8(data, options);
  if (options.method === 'browser') return printWithBrowser(new TextDecoder().decode(data));
  throw new Error('La passerelle locale n’est pas encore configurée.');
}
