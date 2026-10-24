import { use } from './echarts-core.js';
import { HeatmapChart } from 'echarts/charts';
import { GridComponent, VisualMapComponent } from 'echarts/components';
export function register() {
  use([HeatmapChart, GridComponent, VisualMapComponent]);
}
