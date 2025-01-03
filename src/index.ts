import { program } from "commander";
import { validateConfig, parseYamlConfig } from "./config";
import { createServer } from "./server";
import os from 'node:os'

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