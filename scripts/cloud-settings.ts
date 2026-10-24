/** Public deployment metadata and private build inputs have separate contracts. */
import { applyCloudSettings } from './cloud-settings-values.js';
applyCloudSettings(process.env);
