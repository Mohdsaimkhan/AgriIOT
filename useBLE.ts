import { useMemo, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {
  BleError,
  BleManager,
  Characteristic,
  Device,
} from 'react-native-ble-plx';
import * as ExpoDevice from 'expo-device';
import base64 from 'react-native-base64';
import { Alert } from 'react-native';
import Paho from 'paho-mqtt';


const TEMPERATURE_HUMIDITY_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const TEMPERATURE_HUMIDITY_CHARACTERISTIC =
  'beb5483e-36e1-4688-b7f5-ea07361b26a8';

  // const client = new Paho.MQTT.Client(options.host, options.port, options.path);
interface BluetoothLowEnergyApi {
  requestPermissions(): Promise<boolean>;
  scanForPeripherals(): void;
  connectToDevice: (device: Device) => Promise<void>;
  disconnectFromDevice: () => void;
  connectedDevice: Device | null;
  allDevices: Device[];
  temperature: string | null;
  humidity: string | null;
}

const useBLE = (): BluetoothLowEnergyApi => {
  const bleManager = useMemo(() => new BleManager(), []);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [temperature, setTemperature] = useState<string | null>(null);
  const [humidity, setHumidity] = useState<string | null>(null);

  const requestAndroid31Permissions = async () => {
    const bluetoothScanPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      {
        title: 'Location Permission',
        message: 'Bluetooth Low Energy requires Location',
        buttonPositive: 'OK',
      }
    );
    const bluetoothConnectPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: 'Location Permission',
        message: 'Bluetooth Low Energy requires Location',
        buttonPositive: 'OK',
      }
    );
    const fineLocationPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message: 'Bluetooth Low Energy requires Location',
        buttonPositive: 'OK',
      }
    );

    return (
      bluetoothScanPermission === 'granted' &&
      bluetoothConnectPermission === 'granted' &&
      fineLocationPermission === 'granted'
    );
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if ((ExpoDevice.platformApiLevel ?? -1) < 31) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'Bluetooth Low Energy requires Location',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const isAndroid31PermissionsGranted =
          await requestAndroid31Permissions();

        return isAndroid31PermissionsGranted;
      }
    } else {
      return true;
    }
  };

  const isDuplicateDevice = (devices: Device[], nextDevice: Device) =>
    devices.findIndex((device) => nextDevice.id === device.id) > -1;

  const scanForPeripherals = () =>
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.log(error);
      }
      if (device && device.name?.includes('ESP32_BLE_Server')) {
        setAllDevices((prevState: Device[]) => {
          if (!isDuplicateDevice(prevState, device)) {
            return [...prevState, device];
          }
          return prevState;
        });
      }
    });

  const connectToDevice = async (device: Device) => {
    try {
      const deviceConnection = await bleManager.connectToDevice(device.id);
      setConnectedDevice(deviceConnection);
      await deviceConnection.discoverAllServicesAndCharacteristics();
      bleManager.stopDeviceScan();
      startStreamingData(deviceConnection);
    } catch (e) {
      console.log('FAILED TO CONNECT', e);
    }
  };

  const disconnectFromDevice = () => {
    if (connectedDevice) {
      bleManager.cancelDeviceConnection(connectedDevice.id);
      setConnectedDevice(null);
      setTemperature(null);
      setHumidity(null);
    }
  };

  const onDataUpdate = (
    error: BleError | null,
    characteristic: Characteristic | null
  ) => {
    if (error) {
      console.log(error);
      return;
    } else if (!characteristic?.value) {
      console.log('No Data was received');
      return;
    }
    const rawData1 = base64.decode(characteristic.value);
    const rawData = rawData1.toString();
    console.log(rawData);
    const [receivedTemperature,receivedHumidity] = rawData.split(',');
    console.log(receivedTemperature);
    console.log(receivedHumidity);

    setTemperature(receivedTemperature);
    setHumidity(receivedHumidity);
    const timestamp = new Date().toISOString();
    const dataToStore = JSON.stringify({
      temperature: receivedTemperature,
      humidity: receivedHumidity,
      timestamp: timestamp,
    });
    sendTemperatureHumidityDataToServer(receivedTemperature, receivedHumidity);

    try {
      // AsyncStorage.setItem('temperatureHumidityData', dataToStore);
      // Alert.alert("The data has been saved to database");
      // sendStoredDataToServer();
      // const sendStoredDataToServer = async () => {
        // const isConnected = await checkInternetConnection();
        // Alert.alert("The internet is connected");
    
        const options = {
          host: 'mosquitto',
          port: 1883,
          path: '/tmp/hum',
          id: 'id_' + String(Math.random() * 100000),
        };
      
        // if (isConnected) {
          // const storedData = await AsyncStorage.getItem('temperatureHumidityData');
      
          if (dataToStore) {
            const mqttClient = new Paho.Client(
              options.host,
              options.port,
              options.path,
              options.id
            );
            mqttClient.onConnectionLost = (responseObject) => {
              if (responseObject.errorCode !== 0) {
                console.log('onConnectionLost:' + responseObject.errorMessage);
              }
            };
            mqttClient.connect({
              onSuccess: () => {
                console.log('MQTT connected');
                const message = new Paho.Message(dataToStore);
                message.destinationName = options.path;
                mqttClient.send(message);
                // AsyncStorage.removeItem('temperatureHumidityData');
                Alert.alert("The MQTT is sending the data");
              },
              onFailure: (err) => {
                console.log('MQTT connection failed:', err);
                // Alert.alert("The MQTT is  not sendind the datasending the data");
                
              },
            });
          }
        // } else {
        //   console.log('No internet connection. Data not sent.');
        // }
      // };
    
    } catch (e) {
      console.log('Error storing data:', e);
      Alert.alert("Error with MQTT");
    }
  };
  // const checkInternetConnection = async () => {
  //   const netInfoState = await NetInfo.fetch();
  //   return netInfoState.isConnected;
    
  // };
  const sendTemperatureHumidityDataToServer = async (temperature: string, humidity: string) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/sendData', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          temperature,
          humidity,
        }),
      });
  
      if (!response.ok) {
        const errorMessage = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorMessage}`);
      }
  
      const result = await response.json();
      console.log(result.message);
      Alert.alert(result.message);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      console.error('Error sending data to the server:', errorMessage);
      // Alert.alert('There is an error in the sending message:', errorMessage);
    }
  };
  

  const startStreamingData = async (device: Device) => {
    if (device) {
      device.monitorCharacteristicForService(
        TEMPERATURE_HUMIDITY_UUID,
        TEMPERATURE_HUMIDITY_CHARACTERISTIC,
        onDataUpdate
      );
    } else {
      console.log('No Device Connected');
      Alert.alert("The storage of your local device is full");
    }
  };

  return {
    scanForPeripherals,
    requestPermissions,
    connectToDevice,
    allDevices,
    connectedDevice,
    disconnectFromDevice,
    temperature,
    humidity,

  };
  
};

export default useBLE;
