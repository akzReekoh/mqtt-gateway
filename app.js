'use strict';

var async    = require('async'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	server, port, qos;

/*
 * Listen for the message event.
 */
platform.on('message', function (message) {
	server.publish({
		topic: message.device,
		payload: message.message,
		messageId: message.messageId,
		qos: qos,
		retain: false
	}, () => {
		platform.sendMessageResponse(message.messageId, 'Message Published');
		platform.log(JSON.stringify({
			title: 'Message Published',
			device: message.device,
			messageId: message.messageId,
			message: message.message
		}));
	});
});

/*
 * Event to listen to in order to gracefully release all resources bound to this service.
 */
platform.on('close', function () {
	let d = require('domain').create();

	d.once('error', function (error) {
		console.error(`Error closing MQTT Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close(() => {
			d.exit();
		});
	});
});

/*
 * Listen for the ready event.
 */
platform.once('ready', function (options) {
	var map    = require('lodash.map'),
		trim   = require('lodash.trim'),
		uniq   = require('lodash.uniq'),
		keyBy  = require('lodash.keyby'),
		mosca  = require('mosca'),
		config = require('./config.json');

	if (options.qos === 0 || isEmpty(options.qos))
		qos = 0;
	else
		qos = parseInt(options.qos);

	var dataTopic = options.data_topic || config.data_topic.default;
	var messageTopic = options.message_topic || config.message_topic.default;
	var groupMessageTopic = options.groupmessage_topic || config.groupmessage_topic.default;

	var tmpTopics = [dataTopic, messageTopic, groupMessageTopic];
	var authorizedTopics = options.authorized_topics;

	if (!isEmpty(authorizedTopics))
		authorizedTopics = tmpTopics.concat(authorizedTopics.split(','));
	else
		authorizedTopics = tmpTopics;

	authorizedTopics = map(authorizedTopics, trim);
	authorizedTopics = keyBy(uniq(authorizedTopics));

	port = options.port;
	server = new mosca.Server({
		port: port
	});

	server.on('clientConnected', (client) => {
		platform.log(`MQTT Gateway Device Connection received. Device ID: ${client.id}`);
		platform.notifyConnection(client.id);
	});

	server.on('clientDisconnected', (client) => {
		platform.log(`MQTT Gateway Device Disconnection received. Device ID: ${client.id}`);
		platform.notifyDisconnection(client.id);
	});

	server.on('published', (message, client) => {
		let rawMessage = message.payload.toString();

		if (message.topic === dataTopic) {
			async.waterfall([
				async.constant(rawMessage || '{}'),
				async.asyncify(JSON.parse)
			], (error, data) => {
				if (error || isEmpty(data)) {
					server.publish({
						topic: client.id,
						payload: `Invalid data sent. Data must be a valid JSON String. Raw Message: ${rawMessage}`,
						qos: 0,
						retain: false
					});

					return platform.log(new Error(`Invalid data sent. Data must be a valid JSON String. Raw Message: ${rawMessage}`));
				}

				platform.processData(client.id, rawMessage);

				server.publish({
					topic: client.id,
					payload: 'Data Received',
					qos: 0,
					retain: false
				});

				platform.log(JSON.stringify({
					title: 'MQTT Gateway - Data Received',
					device: client.id,
					data: data
				}));
			});
		}
		else if (message.topic === messageTopic) {
			async.waterfall([
				async.constant(rawMessage || '{}'),
				async.asyncify(JSON.parse)
			], (error, msg) => {
				if (error || isEmpty(msg.target) || isEmpty(msg.message)) {
					server.publish({
						topic: client.id,
						payload: 'Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is a registered Device ID. "message" is the payload.',
						qos: 0,
						retain: false
					});

					return platform.handleException(new Error('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is a registered Device ID. "message" is the payload.'));
				}

				platform.sendMessageToDevice(msg.target, msg.message);

				server.publish({
					topic: client.id,
					payload: 'Device Message Received',
					qos: qos,
					retain: false
				});

				platform.log(JSON.stringify({
					title: 'MQTT Gateway - Message Received',
					source: client.id,
					target: msg.target,
					message: msg
				}));
			});
		}
		else if (message.topic === groupMessageTopic) {
			async.waterfall([
				async.constant(rawMessage || '{}'),
				async.asyncify(JSON.parse)
			], (error, msg) => {
				if (error || isEmpty(msg.target) || isEmpty(msg.message)) {
					server.publish({
						topic: client.id,
						payload: 'Invalid group message or command. Group messages must be a valid JSON String with "target" and "message" fields. "target" is a device group id or name. "message" is the payload.',
						qos: 0,
						retain: false
					});

					return platform.handleException(new Error('Invalid group message or command. Group messages must be a valid JSON String with "target" and "message" fields. "target" is a device group id or name. "message" is the payload.'));
				}

				platform.sendMessageToGroup(msg.target, msg.message);

				server.publish({
					topic: client.id,
					payload: 'Group Message Received',
					qos: qos,
					retain: false
				});

				platform.log(JSON.stringify({
					title: 'MQTT Gateway - Group Message Received',
					source: client.id,
					target: msg.target,
					message: msg
				}));
			});
		}
	});

	server.on('delivered', (message) => {
		platform.sendMessageResponse(message.messageId, 'Message Acknowledged');
	});

	server.on('closed', () => {
		console.log(`MQTT Gateway closed on port ${port}`);
		platform.notifyClose();
	});

	server.on('error', (error) => {
		console.error('Server Error', error);
		platform.handleException(error);

		if (error.code === 'EADDRINUSE')
			process.exit(1);
	});

	server.on('ready', () => {
		if (!isEmpty(options.user) && !isEmpty(options.password)) {
			server.authenticate = (client, username, password, callback) => {
				username = (!isEmpty(username)) ? username.toString() : '';
				password = (!isEmpty(password)) ? password.toString() : '';

				if (options.user === username && options.password === password)
					return callback(null, true);
				else {
					platform.log(`MQTT Gateway - Authentication Failed on Client: ${(!isEmpty(client)) ? client.id : 'No Client ID'}.`);
					callback(null, false);
				}
			};
		}

		server.authorizePublish = (client, topic, payload, callback) => {
			platform.requestDeviceInfo(client.id, (error, requestId) => {
				let t = setTimeout(() => {
					platform.removeAllListeners(requestId);
					callback(null, false);
				}, 5000);

				platform.once(requestId, (deviceInfo) => {
					clearTimeout(t);

					let isAuthorized = !isEmpty(deviceInfo) || topic === client.id || !isEmpty(authorizedTopics[topic]);

					if (!isAuthorized) platform.handleException(new Error(`Device ${client.id} is not authorized to publish to topic ${topic}. Device not registered.`));

					return callback(null, isAuthorized);
				});
			});
		};

		server.authorizeSubscribe = (client, topic, callback) => {
			platform.requestDeviceInfo(client.id, (error, requestId) => {
				let t = setTimeout(() => {
					platform.removeAllListeners(requestId);
					callback(null, false);
				}, 5000);

				platform.once(requestId, (deviceInfo) => {
					clearTimeout(t);

					let isAuthorized = !isEmpty(deviceInfo) || topic === client.id || !isEmpty(authorizedTopics[topic]);

					if (!isAuthorized) platform.handleException(new Error(`Device ${client.id} is not authorized to subscribe to topic ${topic}. Device not registered.`));

					callback(null, isAuthorized);
				});
			});
		};

		server.authorizeForward = (client, packet, callback) => {
			platform.requestDeviceInfo(client.id, (error, requestId) => {
				let t = setTimeout(() => {
					platform.removeAllListeners(requestId);
					callback(null, false);
				}, 5000);

				platform.once(requestId, (deviceInfo) => {
					clearTimeout(t);

					let isAuthorized = !isEmpty(deviceInfo);

					if (!isAuthorized) platform.handleException(new Error(`Device ${client.id} is not authorized to forward messages. Device not registered.`));

					return callback(null, isAuthorized);
				});
			});
		};

		platform.log(`MQTT Gateway initialized on port ${port}`);
		platform.notifyReady();
	});
});
