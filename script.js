"use strict";

let port;
let reader;
let inputDone;
let outputDone;
let inputStream;
let outputStream;
let isScanning = false;
let isGettingData = false;
let hibouDevices = [];
let rightDevice = false;
let scannedSensorData = []
let outPutData =[]
const log = document.getElementById("log");
const butConnect = document.getElementById("butConnect");
const butScan = document.getElementById("butScan");
const butGetData = document.getElementById("butGetData");
const outputTable = document.getElementById('dataIntoTable')

document.addEventListener("DOMContentLoaded", () => {
  butScan.addEventListener("click", clickScan);
  butGetData.addEventListener("click", clickGetData);
  butConnect.addEventListener("click", clickConnect);
  const notSupported = document.getElementById("notSupported");
  notSupported.classList.toggle("hidden", "serial" in navigator);
});



/**
 * @name connect
 * Opens a Web Serial connection to a serial device such as a Smart USB Dongle 2.0 and sets up the input and
 * output stream.
 */
async function connect() {
  // - Request a port and open a connection.
  port = await navigator.serial.requestPort();
  // - Wait for the port to open.
  await port.open({ baudRate: 9600 });

  const encoder = new TextEncoderStream();
  outputDone = encoder.readable.pipeTo(port.writable);
  outputStream = encoder.writable;

  let decoder = new TextDecoderStream();
  inputDone = port.readable.pipeTo(decoder.writable);
  inputStream = decoder.readable.pipeThrough(
    new TransformStream(new LineBreakTransformer())
  );

  reader = inputStream.getReader();
  readLoop().catch((error) => {
    toggleUIConnected(false);
    port = null;
    log.textContent = "Dongle Disconnected!";
  });
}

/**
 * @name disconnect
 * Closes the Web Serial connection.
 */
async function disconnect() {
  // Close the input stream (reader).
  if (reader) {
    await reader.cancel();
    await inputDone.catch(() => {});
    reader = null;
    inputDone = null;
  }
  // Close the output stream.
  if (outputStream) {
    await outputStream.getWriter().close();
    await outputDone;
    outputStream = null;
    outputDone = null;
  }
  // Close the port.
  await port.close();
  port = null;
  log.textContent = "Dongle Disconnected!";
}

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 * Checks if port != null
 * If true: Checks if any beacons is advertising or scans are running and stops the advertsing or scan if so. Then runs disconnect() and set toggleUIConnected to false.
 * if false: Runs connect() then set toggleUIConnected to true.
 */
async function clickConnect() {
  log.textContent = "";
  if (port) {

    // If disconnected while scanning the dongle will restart
    if (isScanning) {
      writeCmd("\x03");
      butScan.textContent = "Scan BLE Devices";
      isScanning = false;
    }
    await disconnect();
    toggleUIConnected(false);
    return;
  }
  await connect();
  toggleUIConnected(true);
}

function getSelectedDevice(selectObject) {
  var selectedDevice = selectObject.value;  
  localStorage.setItem("selectedDevice", selectedDevice);
}

/**
 * @name clickScan
 * Click handler for the Scan button.
 * Checks if a scan is already running by checking the boolean isScanning.
 * If isScanning = true: Stops scanning and goes back to peripheral mode, changes the button text and shows the beacon buttons. Finally sets isScanning = false.
 * If isScanning = false: Goes into Central mode and starts scanning for ble devices. Also changes button text and hides the beacon buttons. Finally sets isScanning = true.
 */
function clickScan() {
  console.log("SCAN BUTTON PRESSED");
  if (isScanning) {
    writeCmd("\x03"); // Ctrl+C to stop the scan
    setTimeout(() => {
      writeCmd("AT+PERIPHERAL"); // Set the dongle in Peripheral mode needed for advertising.
    }, 500); // Waiting half a bit to make sure each command will get through separately.
    isScanning = false;
    butGetData.removeAttribute("disabled");
    butScan.textContent = "Scan BLE Devices";
    
    return;
  }
  hibouDevices = [];
  writeCmd("AT+CENTRAL"); // Set the dongle in Central mode needed for scanning.
  setTimeout(() => {
    writeCmd("AT+GAPSCAN=2");
  }, 500); // Waiting half a bit to make sure each command will get through separately.

  butScan.textContent = "Stop Scanning...";
  butGetData.setAttribute("disabled", "true");
  log.classList.toggle("d-none", false);

  isScanning = true;
}

/**
 * @name clickGetData
 * Click handler for the 'Get Data' button.
 * Checks if a getData scan is already running by checking the boolean isGettingData.
 * If isGettingData = true: Stops scanning and goes back to peripheral mode, changes the button text and shows the scan button. Finally sets isGettingData = false.
 * If isGettingData = false: Goes into Central mode and starts scanning for ble devices data. Also changes button text and hides the scan button. Finally sets isGettingData = true.
 */
function clickGetData() {
  console.log("GET DATA BUTTON PRESSED");
  if (isGettingData) {
    writeCmd("\x03"); // Ctrl+C to stop the scan
    setTimeout(() => {
      writeCmd("AT+PERIPHERAL"); // Set the dongle in Peripheral mode needed for advertising.
    }, 500); // Waiting half a bit to make sure each command will get through separately.
    isGettingData = false;
    outputTable.innerHTML = json2Table(outPutData)
    $("#sendorTable").DataTable( {
      dom: 'Bfrtip',
      buttons: [
          'copyHtml5',
          'csvHtml5'
      ]
  } );
    butScan.removeAttribute("disabled");
    butGetData.textContent = "Get Data";
    return;
  }
  writeCmd("AT+CENTRAL"); // Set the dongle in Central mode needed for scanning.
  setTimeout(() => {
   writeCmd("AT+FINDSCANDATA=FF5B07"); // Will just scan for adv data that contains 'FF5B07' which is the tag for Manufaturing Specific Data (FF) and our Company ID (5B07).
  }, 500); // Waiting half a bit to make sure each command will get through separately.

  butGetData.textContent = "Stop Getting Data...";
  butScan.setAttribute("disabled", "true");
  log.classList.toggle("d-none", false);

  isGettingData = true;

  
}


/**
 * @name readLoop
 * Reads data from the input stream and displays it on screen.
 */
async function readLoop() {
  let i=0;
  while (true) {
    i++;
    const { value, done } = await reader.read();
    if (value && (!isScanning && !isGettingData)) {
      log.textContent += value + "\n";
    }
    if (value && isScanning) {
      if(value === "SCAN COMPLETE") {
        isScanning = false;
        butScan.textContent = "Scan BLE Devices";
        log.textContent += "\n" +"Scan Done" + "\n";
        butGetData.removeAttribute("disabled");
        log.classList.toggle("d-none", false);
      }
      let lineValueArray = value.split(" ");
      if (lineValueArray[6] === "(HibouAIR)") {
        if(lineValueArray[2]) {
          hibouDevices.push("["+lineValueArray[2].replace("[1]", "") +"]");

        }
        log.textContent = "\n" + "hibouDevices found: " + hibouDevices.length + "\n";
      }
      if(value === "SCAN COMPLETE") {
        var select = document.getElementById("devices");
        hibouDevices.map(function(item){
          var option = document.createElement("option");
          option.value = item;
          option.text  = item;
          select.appendChild(option)
        });
      }

    }
    if (value && isGettingData) {
      if(value === "SCAN COMPLETE") {
        isGettingData = false;
        butGetData.textContent = "Get Data";
        log.textContent += "\n" +"Scan Done" + "\n";
        butScan.removeAttribute("disabled");
        log.classList.toggle("d-none", false);
        
      }
      let lineValueArray = value.split(" ");
      //if(!rightDevice) { // The advdata is spread on two lines, the first identifies it,
        if (lineValueArray[0] ===   localStorage.getItem("selectedDevice") && lineValueArray[3] === "[ADV]:") {
          //rightDevice = true;
          //console.log("CONSOLE.LOG= "+value);
          scannedSensorData = parseSensorData(lineValueArray[4]);
          if((i%20) === 0) {
            outPutData.push(scannedSensorData)
          }
        log.textContent = "\n" + "SensorData= " + JSON.stringify(scannedSensorData) + "\n";
        }
      //} else if (rightDevice) { // Second line contains the actual advdata string we need to parse
       // console.log(lineValueArray)

        //scannedSensorData = parseSensorData(lineValueArray[4]);
        //log.textContent = "\n" + "SensorData= " + JSON.stringify(scannedSensorData) + "\n";
//console.log(scannedSensorData.p)
        //console.log("CONSOLE.LOG= "+value);
        //rightDevice = false;
      //}

    }
    if (done) {
      console.log("[readLoop] DONE", done);
      reader.releaseLock();
      break;
    }
  }
}

/**
 * @name writeCmd
 * Gets a writer from the output stream and send the command to the Smart USB Dongle 2.0.
 * @param  {string} cmd command to send to the Smart USB Dongle 2.0
 */
function writeCmd(cmd) {
  // Write to output stream
  const writer = outputStream.getWriter();
  console.log("[SEND]", cmd);

  writer.write(cmd);
  // Ignores sending carriage return if sending Ctrl+C
  if (cmd !== "\x03") {
    writer.write("\r"); // Important to send a carriage return after a command
  }
  writer.releaseLock();
}

/**
 * @name LineBreakTransformer
 * TransformStream to parse the stream into lines.
 */
class LineBreakTransformer {
  constructor() {
    // A container for holding stream data until a new line.
    this.container = "";
  }

  transform(chunk, controller) {
    // Handle incoming chunk
    this.container += chunk;
    const lines = this.container.split("\r\n");
    this.container = lines.pop();
    lines.forEach((line) => controller.enqueue(line));
  }

  flush(controller) {
    // Flush the stream.
    controller.enqueue(this.container);
  }
}

/**
 * @name toggleUIConnected
 * Changes the text on butConnect depending on the action it actually will preform in the current state.
 * @param  {boolean} connected true if connected, false if disconnected.
 */
function toggleUIConnected(connected) {
  let lbl = "Connect";
  if (connected) {
    lbl = "Disconnect";
    butGetData.removeAttribute("disabled");
    butScan.removeAttribute("disabled");
  }
  butScan.classList.toggle("disabled", !connected);
  butGetData.classList.toggle("disabled", !connected);
  butConnect.textContent = lbl;
}

/**
 * @name parseSensorData
 * Parse the data from advertising data string.
 * @param  {string} input advertising data string.
 * @returns {object ={sensorid:{string}, p:{int}, t:{int}, h:{int}, als:{int}, pm1:{int}, pm25:{int}, pm10:{int}}} 
 */
function parseSensorData(input) {
  let counter = 13;
  if (input.includes("5B070503")) {
    counter = 17;
  }
  let sensorData = {
    sensorid:
      input[counter + 1] +
      input[counter + 2] +
      input[counter + 3] +
      input[counter + 4] +
      input[counter + 5] +
      input[counter + 6],
    p:
      parseInt(
        input[counter + 13] +
          input[counter + 14] +
          input[counter + 11] +
          input[counter + 12],
        16
      ) / 10,
    t:
      parseInt(
        input[counter + 17] +
          input[counter + 18] +
          input[counter + 15] +
          input[counter + 16],
        16
      ) / 10,
    h:
      parseInt(
        input[counter + 21] +
          input[counter + 22] +
          input[counter + 19] +
          input[counter + 20],
        16
      ) / 10,
      voc:
      parseInt(
        input[counter + 25] +
          input[counter + 26] +
          input[counter + 23] +
          input[counter + 24],
        16
      ) / 10,
    als: parseInt(
      input[counter + 9] +
        input[counter + 10] +
        input[counter + 7] +
        input[counter + 8],
      16
    ),
    pm1:
      parseInt(
        input[counter + 29] +
          input[counter + 30] +
          input[counter + 27] +
          input[counter + 28],
        16
      ) / 10,
    pm25:
      parseInt(
        input[counter + 33] +
          input[counter + 34] +
          input[counter + 31] +
          input[counter + 32],
        16
      ) / 10,
    pm10:
      parseInt(
        input[counter + 37] +
          input[counter + 38] +
          input[counter + 35] +
          input[counter + 36],
        16
      ) / 10}
  return sensorData
}

function json2Table(json) {
  let cols = Object.keys(json[0]);
  //Map over columns, make headers,join into string
  let headerRow = cols
    .map(col => `<th>${col}</th>`)
    .join("");
  let rows = json
    .map(row => {
      let tds = cols.map(col => `<td>${row[col]}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const table = `
	<table id='sendorTable' class='table  table-striped'>
		<thead>
			<tr>${headerRow}</tr>
		<thead>
		<tbody>
			${rows}
		<tbody>
	<table>`;
  return table;
}

