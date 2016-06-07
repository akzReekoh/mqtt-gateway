'use strict';

/**
 * Utility function to validate String Objects
 * @param val The value to be evaluated.
 * @returns {boolean}
 */
var isString = function (val) {
	return typeof val === 'string' || ((!!val && typeof val === 'object') && Object.prototype.toString.call(val) === '[object String]');
};

/**
 * Utility function to validate Error Objects
 * @param val The value to be evaluated.
 * @returns {boolean}
 */
var isError = function (val) {
	return (!!val && typeof val === 'object') && typeof val.message === 'string' && Object.prototype.toString.call(val) === '[object Error]';
};

var generateRequestId = function () {
	return Array
		.apply(0, new Array(8))
		.map(function () {
			return (function (charset) {
				return charset.charAt(Math.floor(Math.random() * charset.length));
			}('abcdefghijklmnopqrstuvwxyz0123456789'));
		})
		.join('');
};

/**
 * Main object used to communicate with the platform.
 * @returns {Platform}
 * @constructor
 */
function Platform() {
	if (!(this instanceof Platform)) return new Platform();

	require('events').EventEmitter.call(this);
	Platform.init.call(this);
}

require('util').inherits(Platform, require('events').EventEmitter);

/**
 * Init function for Platform.
 */
Platform.init = function () {
	['SIGHUP', 'SIGINT', 'SIGTERM'].forEach((signal) => {
		process.on(signal, () => {
			console.log(`Exceuting ${signal} listener...`);
			this.emit('close');

			setTimeout(() => {
				this.removeAllListeners();
				process.exit();
			}, 2000);
		});
	});

	['unhandledRejection', 'uncaughtException'].forEach((exceptionEvent) => {
		process.on(exceptionEvent, (error) => {
			console.error(exceptionEvent, error);
			this.handleException(error);
			this.emit('close');

			setTimeout(() => {
				this.removeAllListeners();
				process.exit(1);
			}, 2000);
		});
	});

	process.on('message', (m) => {
		if (m.type === 'ready')
			this.emit('ready', m.data.options);
		else if (m.type === 'message')
			this.emit('message', m.data);
		else if (m.type === 'close')
			this.emit('close');
		else
			this.emit(m.type, m.data);
	});
};

/**
 * Needs to be called once in order to notify the platform that the plugin has already finished the init process.
 * @param {function} [callback] Optional callback to be called once the ready signal has been sent.
 */
Platform.prototype.notifyReady = function (callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		process.send({
			type: 'ready'
		}, callback);
	});
};

/**
 * Notify the platform that the device has connected to this gateway. The platform will update the device status to online.
 * @param {string} device The client or device identifier.
 * @param {function} [callback] Optional callback to be called once the connection signal has been sent.
 */
Platform.prototype.notifyConnection = function (device, callback) {
	callback = callback || function () {
		};

	if (!device || !isString(device)) return callback(new Error('A valid client/device identifier is required.'));

	process.send({
		type: 'connection',
		data: device
	}, callback);
};

/**
 * Notify the platform that the device has disconnected from this gateway. The platform will update the device status to offline.
 * @param {string} device The client or device identifier.
 * @param {function} [callback] Optional callback to be called once the disconnect signal has been sent.
 */
Platform.prototype.notifyDisconnection = function (device, callback) {
	callback = callback || function () {
		};

	if (!device || !isString(device)) return callback(new Error('A valid client/device identifier is required.'));

	process.send({
		type: 'disconnect',
		data: device
	}, callback);
};

/**
 * Notifies the platform that resources have been released and this plugin can shutdown gracefully.
 * @param {function} [callback] Optional callback to be called once the close signal has been sent.
 */
Platform.prototype.notifyClose = function (callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		process.send({
			type: 'close'
		}, callback);
	});
};

/**
 * Gets the Device Information from the platform based on the Device ID passed.
 * Returns an auto-generated Request ID or event to listen to for the device data.
 * @param {string} device The client or device identifier.
 * @param {function} callback(error, requestId) Callback function to be called that returns a request id to listen to for the device information. Device information includes the Device ID, Name, Metadata and State.
 */
Platform.prototype.requestDeviceInfo = function (device, callback) {
	if (typeof callback !== 'function') return callback(new Error('Please specify a valid callback function.'));

	let requestId = generateRequestId();

	setImmediate(() => {
		callback(null, requestId);
	});

	process.send({
		type: 'requestdeviceinfo',
		data: {
			requestId: requestId,
			deviceId: device
		}
	}, (error) => {
		if (error) this.removeAllListeners(requestId);
	});
};

/**
 * Sets the device' state on the platform. State can be any information based on incoming data being received
 * from the device or any other arbitrary information that needs to be stored dynamically.
 * @param {string} device The client or device identifier.
 * @param {any|object|string|number|date|array} state Information to store as device' state.
 * @param {function} [callback] Optional callback to be called once the signal has been sent.
 */
Platform.prototype.setDeviceState = function (device, state, callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		process.send({
			type: 'setdevicestate',
			data: {
				deviceId: device,
				state: state
			}
		}, callback);
	});
};

/**
 * Sends the device/sensor data to the platform to be processed.
 * @param {string} device The client or device identifier.
 * @param {string} data The JSON data to be processed.
 * @param callback Optional callback to be called once the data has been sent.
 */
Platform.prototype.processData = function (device, data, callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		if (!device || !isString(device)) return callback(new Error('A valid client/device identifier is required.'));
		if (!data || !isString(data)) return callback(new Error('A valid data is required.'));

		process.send({
			type: 'data',
			data: {
				device: device,
				data: data
			}
		}, callback);
	});
};

/**
 * Send a message or command to a device.
 * @param {string} device The device identifier to send the message or command to.
 * @param {string} message The message or command to be sent to the device.
 * @param {function} [callback] Optional callback to be called once the message has been sent.
 */
Platform.prototype.sendMessageToDevice = function (device, message, callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		if (!device || !isString(device)) return callback(new Error('A valid device id is required.'));
		if (!message || !isString(message)) return callback(new Error('A valid message is required.'));

		process.send({
			type: 'message',
			data: {
				device: device,
				message: message
			}
		}, callback);
	});
};

/**
 * Send a message or command to a group of devices.
 * @param {string} group The device group name.
 * @param {string} message The message or command to send to the group of devices.
 * @param {function} [callback] Optional callback to be called once the message has been sent.
 */
Platform.prototype.sendMessageToGroup = function (group, message, callback) {
	callback = callback || function () {
		};

	setImmediate(() => {
		if (!group || !isString(group)) return callback(new Error('A valid group name is required.'));
		if (!message || !isString(message)) return callback(new Error('A valid message is required.'));

		process.send({
			type: 'message',
			data: {
				group: group,
				message: message
			}
		}, callback);
	});
};

/**
 * Sends back a response to the message sent to the device through this gateway. These responses may be acknowledgement receipts that
 * come from the devices connected to this gateway.
 * @param {string} messageId The message id that was sent
 * @param response
 * @param callback
 */
Platform.prototype.sendMessageResponse = function (messageId, response, callback) {
	callback = callback || function () {
		};

	if (!messageId || !isString(messageId)) return callback(new Error('A valid message id is required.'));
	if (!response || !isString(response)) return callback(new Error('A valid response is required.'));

	process.send({
		type: 'response',
		data: {
			messageId: messageId,
			response: response
		}
	}, callback);
};

/**
 * Logs any data to the attached loggers in the topology.
 * @param {string} data The data that needs to be logged.
 * @param {function} [callback] Optional callback to be called once the data has been sent.
 */
Platform.prototype.log = function (data, callback) {
	callback = callback || function () {
		};

	if (!data || !isString(data)) return callback(new Error('A valid log data is required.'));

	process.send({
		type: 'log',
		data: data
	}, callback);
};

/**
 * Logs errors to all the attached exception handlers in the topology.
 * @param {error} error The error to be handled/logged
 * @param {function} [callback] Optional callback to be called once the error has been sent.
 */
Platform.prototype.handleException = function (error, callback) {
	callback = callback || function () {
		};

	if (!isError(error)) return callback(new Error('A valid error object is required.'));

	setImmediate(() => {
		process.send({
			type: 'error',
			data: {
				name: error.name,
				message: error.message,
				stack: error.stack
			}
		}, callback);
	});
};

module.exports = new Platform();
