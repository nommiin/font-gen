const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

function rewriteProperty(lines, name, val) {
    for(let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith(name)) {
            lines[i] = name + "=" + val;
            return;
        }
    }
    throw `Could not rewrite config, failed to find ${name} property`;
}

function rewriteAsset(file) {
    if (!fs.existsSync(file)) {
        throw `Could not find file ${file}`;
    }

    const content = cleanJSON(fs.readFileSync(file, {encoding: "utf-8"}));
    fs.writeFileSync(file, content.replaceAll(`"offset": null`, `"offset": 0`));
}

function cleanJSON(blob) {
    const removal = [];
    for(let i = 0; i < blob.length; i++) {
        switch (blob[i]) {
            case ",": {
                let base = i + 1;
                while (blob[base].charCodeAt(0) <= 32) {
                    if (++base > blob.length) {
                        break;
                    }
                }

                switch (blob[base]) {
                    case "]":
                    case "}": {
                        removal.push(i);
                        break;
                    }
                }
                break;
            }
        }
    }

    let cleaned = blob;
    for(let i = 0; i < removal.length; i++) {
        const pos = removal[i] - i;
        cleaned = cleaned.slice(0, pos) + cleaned.slice(pos + 1);
    }
    return cleaned;
}

function getProject() {
    return {
        resourceType: "GMProject",
        resourceVersion: "1.6",
        name: "export",
        resources: [],
        Options: [],
        defaultScriptType: 1,
        isEcma: false,
        configs: {
            name: "Default",
            children: []
        },
        RoomOrderNodes: [],
        Folders: [],
        AudioGroups: [],
        TextureGroups: [],
        IncludedFiles: [],
        MetaData: {
            IDEVersion: "2022.1100.0.248"
        }
    }
}

const arg = {};
for(let i = 0, _ = process.argv.splice(2); i < _.length; i += 2) {
    arg[_[i].slice(1)] = _[i + 1];
}

const DEFAULT_SIZE = 1024, EXPORT_PATH = "export\\", YAL_EXEC = "depend\\BmFontToYY23.exe", BMFONT_EXEC = "depend\\bmfont64.com";
try {
    if (!fs.existsSync(BMFONT_EXEC)) {
        throw `Could not find BMFont executable in ${BMFONT_EXEC}`;
    }

    if (!fs.existsSync(YAL_EXEC)) {
        throw `Could not find BMFontToYY23.exe in ${YAL_EXEC}`;
    }
    
    const input = arg.input;
    if (input === undefined) {
        throw `Could not find \"input\" argument`;
    }

    // Load input data
    let data = undefined;
    if (input.endsWith(".json")) {
        if (!fs.existsSync(input)) {
            throw `Could not find file "${input}" from input argument`;
        }

        data = JSON.parse(fs.readFileSync(input, {encoding: "utf-8"}));
    } else {
        data = JSON.parse(input);
    }

    // Configuration checking
    const config = data.Configuration ?? {};
    if (config === undefined) {
        console.log(`Could not find configuration property, using default values`);
    }

    let size = config.Size;
    if (size === undefined) {
        console.log(`Could not find size in configuration, defaulting to ${DEFAULT_SIZE}x${DEFAULT_SIZE}`);
        size = {
            Width: DEFAULT_SIZE,
            Height: DEFAULT_SIZE
        };
    }

    if (size.Width !== size.Height) {
        throw `Could not handle input data, configuration size "${size.Width}x${size.Height}" is invalid; width and height must be equal`;
    }

    if (Math.log2(size.Width) % 1 !== 0 || Math.log2(size.Height) % 1 !== 0) {
        throw `Could not handle input data, configuration size "${size.Width}x${size.Height}" is not a power of two`;
    }

    // Copy BMFC as temp 
    const config_file = config.File ?? "gm23.bmfc";
    if (!fs.existsSync(config_file)) {
        throw `Could not create config, configuration file could not be found`;
    }

    const temp_file = path.dirname(config_file) + "/" + "TEMP.bmfc";
    if (!fs.existsSync(temp_file)) {
        fs.copyFileSync(config_file, temp_file);
    }

    // Setup default settings
    const temp = fs.readFileSync(temp_file, {encoding: "utf-8"}).split("\n");
    rewriteProperty(temp, "outWidth", size.Width);
    rewriteProperty(temp, "outHeight", size.Width);

    // Run BMFont for all
    const fonts = data.Fonts;
    if (fonts === undefined) {
        throw `Could not handle input data, fonts property does not exist`;
    }

    // Export folder
    if (!fs.existsSync(EXPORT_PATH)) {
        fs.mkdirSync(EXPORT_PATH);
    }

    const bmfont_path = path.join(EXPORT_PATH, "bmfont");
    if (!fs.existsSync(bmfont_path)) {
        fs.mkdirSync(bmfont_path);
    }

    const font_path = path.join(EXPORT_PATH, "fonts");
    if (!fs.existsSync(font_path)) {
        fs.mkdirSync(font_path);
    }
    
    // Dummy project
    const project = getProject();

    const scale = config.Scale ?? 1, time = performance.now();
    for(let i = 0; i < fonts.length; i++) {
        const font = fonts[i];
        rewriteProperty(temp, "fontName", font.Name);
        rewriteProperty(temp, "fontSize", font.Size * scale);

        const range = (font.Range === undefined ? "32-126" : `${font.Range[0]}-${font.Range[1]}`);
        rewriteProperty(temp, "chars", range);

        const padding = font.Padding ?? {Right: 2, Down: 2, Left: 2, Up: 0};
        rewriteProperty(temp, "paddingDown", padding.Down);
        rewriteProperty(temp, "paddingUp", padding.Up);
        rewriteProperty(temp, "paddingRight", padding.Right);
        rewriteProperty(temp, "paddingLeft", padding.Left);
        fs.writeFileSync(temp_file, temp.join("\n"));

        const name = (config.Prefix ?? "fnt") + (font.File ?? font.Name.replace(" ", "_")) + (config.Postfix ?? "");
        console.log(`- Generating ${name}.fnt from ${font.Name} (Size: ${font.Size}px${scale > 1 ? " (*" + scale + ")" : ""}, Range: ${range})`);        
        child_process.spawnSync(`${BMFONT_EXEC}`, ["-c", "depend\\TEMP.bmfc", "-o", `${path.join(bmfont_path, name)}.fnt`]);

        const font_folder = path.join(font_path, name);
        if (!fs.existsSync(font_folder)) {
            fs.mkdirSync(font_folder);
        }

        console.log(`- Generating .yy from ${name} to ${font_folder}`);
        const font_file = path.join(bmfont_path, name + ".fnt");
        if (!fs.existsSync(font_file)) {
            throw `Could not generate YY file, file "${font_file}" does not exist`;
        }

        const font_asset = path.join(font_folder, name + ".yy");
        child_process.spawnSync(`${YAL_EXEC}`, [path.normalize(font_file), font_asset]);
        rewriteAsset(font_asset);

        project.resources.push({
            id: {name: name, path: font_asset.slice("export\\".length)},
            order: i
        });
        console.log("Finished.\n");
    }
    fs.unlinkSync(temp_file);

    // Create project
    console.log(`- Generating export.yyp for ${fonts.length} fonts`);
    fs.writeFileSync(path.join(EXPORT_PATH, "export.yyp"), JSON.stringify(project, undefined, 4));

    console.log(`Exported ${fonts.length} fonts in ${Math.round(performance.now() - time)}ms`);
} catch (e) {
    console.error(`An exception in font-gen occured:\n- ${e}`);
    process.exit(1);
}