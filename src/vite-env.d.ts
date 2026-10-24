/// <reference types="vite/client" />

declare interface Bluetooth { requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>; }
declare interface BluetoothDevice { gatt?: BluetoothRemoteGATTServer; }
declare interface BluetoothRemoteGATTServer { connect(): Promise<BluetoothRemoteGATTServer>; getPrimaryServices(service?: number | string): Promise<BluetoothRemoteGATTService[]>; getPrimaryService(service: number | string): Promise<BluetoothRemoteGATTService>; }
declare interface BluetoothRemoteGATTService { getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>; getCharacteristic(uuid: number | string): Promise<BluetoothRemoteGATTCharacteristic>; }
declare interface BluetoothRemoteGATTCharacteristic { properties: { write?: boolean; writeWithoutResponse?: boolean }; writeValue(value: BufferSource): Promise<void>; writeValueWithoutResponse?: (value: BufferSource) => Promise<void>; }
declare interface RequestDeviceOptions { filters?: Array<{ name?: string }>; optionalServices?: Array<number | string>; }
