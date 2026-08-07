import { style } from './styles.js';

export const USAGE = `${style.bold('klairox')} - data-driven 2D asset composition

${style.bold('Usage')}
  klairox <command> <plugin-dir> [options]

${style.bold('Commands')}
  generate   Compose the selected layers and export the asset
  batch      Expand a variant matrix and export every valid combination
  validate   Check a plugin manifest and every asset it declares
  info       List the layers, options and constraints of a plugin

${style.bold('Generate / batch options')}
  -s, --select <layer=option>   Pick an option; repeat for each layer
  -o, --out <dir>               Output directory (default: dist/assets)
  -n, --name <name>             Base file name, or name template for batch
  -f, --format <png|webp>       Override the formats declared by the plugin
      --quality <number>        Encoder effort: 0-9 for png, 0-100 for webp
      --no-thumbnail            Skip the thumbnail
      --no-metadata             Skip the JSON sidecar

${style.bold('Batch options')}
  -a, --axis <layer>            Axis to expand; repeat; overrides manifest axes
      --dry-run                 List planned variants without writing files
      --force                   Ignore the plan-hash cache and regenerate
      --concurrency <n>         Max parallel renders (default: 4)

${style.bold('Global options')}
  -h, --help                    Show this help
  -v, --version                 Show the version

${style.bold('Examples')}
  klairox info plugins/horse
  klairox validate plugins/horse
  klairox generate plugins/horse -s coat=bay -s equipment=saddle -o dist/assets
  klairox batch plugins/horse --dry-run
  klairox batch plugins/horse -a coat -a mane -o dist/batch
`;
