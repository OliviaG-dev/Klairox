import { style } from './styles.js';

export const USAGE = `${style.bold('klairox')} - data-driven 2D asset composition

${style.bold('Usage')}
  klairox <command> <plugin-dir> [options]

${style.bold('Commands')}
  generate   Compose the selected layers and export the asset
  validate   Check a plugin manifest and every asset it declares
  info       List the layers, options and constraints of a plugin

${style.bold('Generate options')}
  -s, --select <layer=option>   Pick an option; repeat for each layer
  -o, --out <dir>               Output directory (default: dist/assets)
  -n, --name <name>             Base file name (default: the plugin name)
  -f, --format <png|webp>       Override the formats declared by the plugin
      --quality <number>        Encoder effort: 0-9 for png, 0-100 for webp
      --no-thumbnail            Skip the thumbnail
      --no-metadata             Skip the JSON sidecar

${style.bold('Global options')}
  -h, --help                    Show this help
  -v, --version                 Show the version

${style.bold('Examples')}
  klairox info plugins/horse
  klairox validate plugins/horse
  klairox generate plugins/horse -s coat=bay -s equipment=saddle -o dist/assets
`;
