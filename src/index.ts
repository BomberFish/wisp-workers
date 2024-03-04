//bomberfish

// Whisper: A Wisp implementation using Cloudflare Workers.

import FrameParsers, { continuePacketMaker, dataPacketMaker } from './Packets';
import { STREAM_TYPE, CONNECT_TYPE, WispFrame } from './Types';
import { Buffer } from 'node:buffer';

import { connect } from 'cloudflare:sockets';

export default {
	async fetch(request: Request /*, ctx: ExecutionContext*/) {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader !== 'websocket') {
			// Wisp operates on websockets.
			return new Response(
				'<!DOCTYPE html><html><head><title>Whisper - Error</title><style>body{font-family: system-ui, sans-serif;background:#1e1e2e;color:#cdd6f4;padding: 1%;}</style></head><h1>How did we get here?</h1><p>Please connect with WebSocket.</p><img src="https://http.cat/426" /></html>',
				{ status: 426, headers: { 'Content-Type': 'text/html' } },
			);
		}

		// pretty sure this is deprecated now

		// if (request.headers.get('Sec-WebSocket-Protocol') != 'wisp-v1') {
		// 	// This is self explanatory
		// 	return new Response(
		// 		'<!DOCTYPE html><html><head><title>Whisper - Error</title><style>body{font-family: system-ui, sans-serif;background:#1e1e2e;color:#cdd6f4;padding: 1%;}</style></head><h1>How did we get here?</h1><p>Only wisp-v1 is supported.</p><img src="https://http.cat/501" /></html>',
		// 		{ status: 501, headers: { 'Content-Type': 'text/html' } },
		// 	);
		// }

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		const connections = new Map();

		server.accept();
		console.log('Server accepted');
		server.send(FrameParsers.continuePacketMaker({ streamID: 0 } as WispFrame, 127));
		console.log('Sending CONTINUE packet');
		server.addEventListener('message', async (event) => {
			console.info('Got a message');
			console.debug(event.data as string);
			try {
				const frame = FrameParsers.wispFrameParser(Buffer.from(event.data));
				switch (frame.type) {
					case CONNECT_TYPE.CONNECT:
						console.log('CONNECT');
						const connectFrame = FrameParsers.connectPacketParser(frame.payload);
						try {
							const client = connect({
								hostname: connectFrame.hostname,
								port: connectFrame.port,
							});
							connections.set(frame.streamID, { client: client, buffer: 127 });
							let read = await client.readable.getReader().read();
							server.send(FrameParsers.dataPacketMaker(frame, read));
						} catch (e) {
							server.send(FrameParsers.closePacketMaker(frame, 0x03));
							throw e + ' (connect)'; // hot potato
						}
					case CONNECT_TYPE.DATA:
						try {
							console.log('DATA');
							if (!connections.has(frame.streamID)) {
								// This only happens when you send data without establishing a connection first. Essentially, skill issue.
								server.send(FrameParsers.closePacketMaker(frame, 0x41)); // 0x41 is defined as "invalid information" in the wisp spec
							}
							const stream = connections.get(frame.streamID);
							console.log('Writing data');
							stream.client.writable.getWriter().write(frame.payload); // writable???? cryptoshart reference??????
							console.log('Data written');
							stream.buffer--;
							if (stream.buffer == 0) {
								stream.buffer = 127;
								server.send(continuePacketMaker(frame, stream.buffer));
							}
						} catch (e) {
							server.send(FrameParsers.closePacketMaker(frame, 0x03));
							throw e + ' (data)';
						}
					case CONNECT_TYPE.CLOSE:
						console.debug('Client closed with reason', new DataView(frame.payload.buffer).getUint8(0));
						(connections.get(frame.streamID).client as Socket).close();
						connections.delete(frame.streamID);
				}
			} catch (e) {
				console.error('ERROR: ' + e + '. Closing connnection.');
				server.close();
			}
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	},
};
