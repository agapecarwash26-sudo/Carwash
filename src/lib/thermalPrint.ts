/**
 * Best-effort Web Bluetooth ESC/POS printing for browsers that expose Web Bluetooth.
 * iOS Safari does not expose Web Bluetooth, so callers must use the iOS print/share fallback.
 */
type BleCharacteristic = { properties?: Record<string, boolean>; writeValue?: (data: BufferSource) => Promise<void>; writeValueWithoutResponse?: (data: BufferSource) => Promise<void> };
type BleService = { getCharacteristics: () => Promise<BleCharacteristic[]> };
type BleServer = { getPrimaryServices: () => Promise<BleService[]> };
type BleDevice = { name?: string; gatt?: { connect: () => Promise<BleServer> } };
type BluetoothApi = { requestDevice: (options: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<BleDevice> };

function bluetooth(): BluetoothApi | null {
  const api = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
  return api ?? null;
}

export function supportsDirectBluetooth(): boolean {
  return Boolean(bluetooth());
}

function escPosText(text: string): Uint8Array {
  const encoder = new TextEncoder();
  const clean = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const bytes = encoder.encode(clean);
  const out = new Uint8Array(bytes.length + 8);
  out.set([0x1b, 0x40], 0);
  out.set(bytes, 2);
  out.set([0x0a, 0x0a, 0x1d, 0x56, 0x00], bytes.length + 2);
  return out;
}

async function findWritableCharacteristic(server: BleServer): Promise<BleCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    const writable = chars.find(c => c.properties?.writeWithoutResponse || c.properties?.write);
    if (writable) return writable;
  }
  throw new Error('Aucune caractéristique Bluetooth d’écriture n’a été trouvée sur l’imprimante.');
}

export async function printEscPos(text: string): Promise<string> {
  const api = bluetooth();
  if (!api) throw new Error('Bluetooth direct non disponible dans ce navigateur.');
  const device = await api.requestDevice({ acceptAllDevices: true, optionalServices: [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  ] });
  if (!device.gatt) throw new Error('L’imprimante Bluetooth ne fournit pas de connexion GATT.');
  const server = await device.gatt.connect();
  const characteristic = await findWritableCharacteristic(server);
  const data = escPosText(text);
  const chunkSize = 180;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else if (characteristic.writeValue) await characteristic.writeValue(chunk);
    else throw new Error('Le canal Bluetooth ne permet pas l’écriture.');
  }
  return device.name || 'imprimante Bluetooth';
}
