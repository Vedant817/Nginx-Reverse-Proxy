import http from 'node:http'
import { ConfigSchemaType, rootConfigSchema } from "./config-schema";
import cluster, { Worker } from 'node:cluster'
import { workerMessageReplySchema, WorkerMessageReplyType, WorkerMessageType, workerMessageSchema } from './server-schema';

export interface serverConfig {
    port: number
    workerCount: number
    config: ConfigSchemaType
}

export async function createServer(config: serverConfig) {
    const { workerCount } = config;

    const workerPool: Worker[] = [];

    if (cluster.isPrimary) {
        console.log('Master Process is Up');

        for (let i = 0; i < workerCount; i++) {
            const w = cluster.fork({ config: JSON.stringify(config.config) });
            workerPool.push(w)
            console.log(`Master Process: Worker Node spinned up ${i + 1}`)
        }

        const server = http.createServer(function (req, res) {
            const index = Math.floor(Math.random() * workerPool.length);
            const worker = workerPool.at(index)

            if (!worker) {
                res.writeHead(500);
                res.end('No workers available');
                return;
            }

            // Create a promise to handle the worker response
            const responsePromise = new Promise<void>((resolve, reject) => {
                const messageHandler = async (workerReply: string) => {
                    try {
                        const reply = await workerMessageReplySchema.parseAsync(JSON.parse(workerReply));
                        
                        if(reply.errorCode){
                            res.writeHead(parseInt(reply.errorCode));
                            res.end(reply.error);
                        } else {
                            res.writeHead(200);
                            res.end(reply.data);
                        }
                        // Clean up the listener after handling the response
                        worker.off('message', messageHandler);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };

                worker.on('message', messageHandler);

                // Handle if worker dies or disconnects
                worker.once('exit', () => {
                    reject(new Error('Worker died unexpectedly'));
                });
            });

            // Handle request body for POST requests
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                const payload: WorkerMessageType = {
                    requestType: 'HTTP',
                    headers: req.headers,
                    body: body || null,
                    url: req.url as string
                };

                worker.send(JSON.stringify(payload));
            });

            // Set a timeout for the response
            const timeout = setTimeout(() => {
                res.writeHead(504);
                res.end('Gateway Timeout');
            }, 30000); // 30 second timeout

            responsePromise
                .catch(error => {
                    console.error('Error handling request:', error);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                })
                .finally(() => {
                    clearTimeout(timeout);
                });
        });

        server.listen(config.port, function () {
            console.log('Reverse Proxy Server Listening')
        })

    } else {
        console.log('Worker Node');
        const config = await rootConfigSchema.parseAsync(JSON.parse(`${process.env.config}`));

        process.on('message', async (message: string) => {
            try {
                const messageValidated = await workerMessageSchema.parseAsync(JSON.parse(message));

                const requestUrl = messageValidated.url
                const rule = config.server.rules.find(e => e.path === requestUrl);

                if (!rule) {
                    const reply: WorkerMessageReplyType = {
                        errorCode: '404',
                        error: 'Rule Not found',
                    };

                    if (process.send) {
                        process.send(JSON.stringify(reply));
                        return;
                    }
                }

                const upstreamId = rule?.upstream[0]
                const upstream = config.server.upstreams.find(e => e.id === upstreamId)

                if (!upstream) {
                    const reply: WorkerMessageReplyType = {
                        errorCode: '500',
                        error: 'Upstream Not found',
                    };

                    if (process.send) {
                        process.send(JSON.stringify(reply));
                        return;
                    }
                }

                const request = http.request({
                    host: upstream?.url,
                    path: requestUrl,
                    method: messageValidated.headers['method'] || 'GET',
                    headers: messageValidated.headers,
                }, (proxyRes) => {
                    let body = "";

                    proxyRes.on('data', (chunk) => {
                        body += chunk;
                    });

                    proxyRes.on('end', () => {
                        const reply: WorkerMessageReplyType = {
                            data: body
                        }

                        if(process.send) process.send(JSON.stringify(reply));
                    });
                });

                request.on('error', (error) => {
                    const reply: WorkerMessageReplyType = {
                        errorCode: '500',
                        error: `Bad Gateway: ${error.message}`,
                    };

                    if(process.send) process.send(JSON.stringify(reply));
                });

                // Write the body if it exists
                if (messageValidated.body) {
                    request.write(messageValidated.body);
                }
                request.end();
            } catch (error) {
                const reply: WorkerMessageReplyType = {
                    errorCode: '500',
                    error: `Internal Server Error: ${error}`,
                };

                if(process.send) process.send(JSON.stringify(reply));
            }
        });
    }
}