import { use } from './echarts-core.js';
import { LineChart, BarChart, ScatterChart, CustomChart } from 'echarts/charts';
import {
  GridComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
} from 'echarts/components';
export function register() {
  use([
    LineChart,
    BarChart,
    ScatterChart,
    CustomChart,
    GridComponent,
    DataZoomComponent,
    MarkLineComponent,
    MarkAreaComponent,
    MarkPointComponent,
  ]);
}
