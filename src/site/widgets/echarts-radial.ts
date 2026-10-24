import { use } from './echarts-core.js';
import { PieChart, RadarChart } from 'echarts/charts';
import { RadarComponent } from 'echarts/components';
export function register() {
  use([PieChart, RadarChart, RadarComponent]);
}
