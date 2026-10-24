import { use } from './echarts-core.js';
import { TreemapChart, SunburstChart } from 'echarts/charts';
export function register() {
  use([TreemapChart, SunburstChart]);
}
