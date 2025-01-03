import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { rootConfigSchema } from './config-schema';

export async function parseYamlConfig(filePath: string) {
    const configFileContent = await fs.readFile(filePath, 'utf8');
    const configParse = parse(configFileContent);

    return JSON.stringify(configParse);
}

export async function validateConfig(config: string){
    const validatedConfig = await rootConfigSchema.parseAsync(JSON.parse(config))

    return validatedConfig;
}