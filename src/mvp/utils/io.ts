export const writeToFile = async (data: string | Uint8Array, path: string) => {
    try {
        await Bun.write(path, data);
    } catch (err) {
        console.error(`Failed to write file ${path}:`, err);
        throw err;
    }
};

// JSON-specific writer
export const writeToJsonFile = async (data: object | object[], path: string) => {
    const ext = path.endsWith('.json') ? '' : '.json';
    const finalPath = path + ext;
    const json = JSON.stringify(data, null, 4); // only stringify here
    await writeToFile(json, finalPath); // pass plain string
};
