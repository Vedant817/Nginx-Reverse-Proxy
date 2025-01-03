"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const node_http_1 = __importDefault(require("node:http"));
const config_schema_1 = require("./config-schema");
const node_cluster_1 = __importDefault(require("node:cluster"));
const server_schema_1 = require("./server-schema");
function createServer(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const { workerCount } = config;
        const workerPool = [];
        if (node_cluster_1.default.isPrimary) {
            console.log('Master Process is Up');
            for (let i = 0; i < workerCount; i++) {
                const w = node_cluster_1.default.fork({ config: JSON.stringify(config.config) });
                workerPool.push(w);
                console.log(`Master Process: Worker Node spinned up ${i + 1}`);
            }
            const server = node_http_1.default.createServer(function (req, res) {
                const index = Math.floor(Math.random() * workerPool.length);
                const worker = workerPool.at(index);
                if (!worker) {
                    res.writeHead(500);
                    res.end('No workers available');
                    return;
                }
                // Create a promise to handle the worker response
                const responsePromise = new Promise((resolve, reject) => {
                    const messageHandler = (workerReply) => __awaiter(this, void 0, void 0, function* () {
                        try {
                            const reply = yield server_schema_1.workerMessageReplySchema.parseAsync(JSON.parse(workerReply));
                            if (reply.errorCode) {
                                res.writeHead(parseInt(reply.errorCode));
                                res.end(reply.error);
                            }
                            else {
                                res.writeHead(200);
                                res.end(reply.data);
                            }
                            // Clean up the listener after handling the response
                            worker.off('message', messageHandler);
                            resolve();
                        }
                        catch (error) {
                            reject(error);
                        }
                    });
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
                    const payload = {
                        requestType: 'HTTP',
                        headers: req.headers,
                        body: body || null,
                        url: req.url
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
                console.log('Reverse Proxy Server Listening');
            });
        }
        else {
            console.log('Worker Node');
            const config = yield config_schema_1.rootConfigSchema.parseAsync(JSON.parse(`${process.env.config}`));
            process.on('message', (message) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const messageValidated = yield server_schema_1.workerMessageSchema.parseAsync(JSON.parse(message));
                    const requestUrl = messageValidated.url;
                    const rule = config.server.rules.find(e => e.path === requestUrl);
                    if (!rule) {
                        const reply = {
                            errorCode: '404',
                            error: 'Rule Not found',
                        };
                        if (process.send) {
                            process.send(JSON.stringify(reply));
                            return;
                        }
                    }
                    const upstreamId = rule === null || rule === void 0 ? void 0 : rule.upstream[0];
                    const upstream = config.server.upstreams.find(e => e.id === upstreamId);
                    if (!upstream) {
                        const reply = {
                            errorCode: '500',
                            error: 'Upstream Not found',
                        };
                        if (process.send) {
                            process.send(JSON.stringify(reply));
                            return;
                        }
                    }
                    const request = node_http_1.default.request({
                        host: upstream === null || upstream === void 0 ? void 0 : upstream.url,
                        path: requestUrl,
                        method: messageValidated.headers['method'] || 'GET',
                        headers: messageValidated.headers,
                    }, (proxyRes) => {
                        let body = "";
                        proxyRes.on('data', (chunk) => {
                            body += chunk;
                        });
                        proxyRes.on('end', () => {
                            const reply = {
                                data: body
                            };
                            if (process.send)
                                process.send(JSON.stringify(reply));
                        });
                    });
                    request.on('error', (error) => {
                        const reply = {
                            errorCode: '500',
                            error: `Bad Gateway: ${error.message}`,
                        };
                        if (process.send)
                            process.send(JSON.stringify(reply));
                    });
                    // Write the body if it exists
                    if (messageValidated.body) {
                        request.write(messageValidated.body);
                    }
                    request.end();
                }
                catch (error) {
                    const reply = {
                        errorCode: '500',
                        error: `Internal Server Error: ${error}`,
                    };
                    if (process.send)
                        process.send(JSON.stringify(reply));
                }
            }));
        }
    });
}
