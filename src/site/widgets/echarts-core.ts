import { use } from 'echarts/core';
import { TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
use([TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);
export { use, init } from 'echarts/core';
