import { program } from "commander";
import { validateConfig, parseYamlConfig } from "./config";
import  cluster  from 'node:cluster'
import os from 'node:os'
import http from 'node:http'
import { ConfigSchemaType } from "./config-schema";

interface serverConfig {
    port: number
    workerCount: number
    config: ConfigSchemaType
}

async function createServer(config: serverConfig) {
    const { workerCount } = config;

    if(cluster.isPrimary){
        console.log('Master Process is Up');

        for(let i = 0;  i < workerCount; i++){
            cluster.fork({config: JSON.stringify(config.config)});
            console.log(`Master Process: Worker Node spinned up ${i + 1}`)
        }

        const server = http.createServer(function(req, res){

        })

    } else {
        console.log('Worker Node', process.env.config)
    }    
}

async function main() {
    program.option('--config <path>');
    program.parse();

    const options = program.opts();
    if (options && 'config' in options) {
        const validatedConfig = await validateConfig(await parseYamlConfig(options.config));
        await createServer({port: validatedConfig.server.listen, workerCount: validatedConfig.server.workers ?? os.cpus().length, config: validatedConfig})
    }
}

main()