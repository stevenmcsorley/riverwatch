import { memo, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { RadarPlayback } from './radar-playback.mjs';

export default memo(function RadarLayer({frames,index,opacity,playing,host,onState}) {
  const map = useMap(), controller = useRef(null), callback = useRef(onState);
  callback.current = onState;
  useEffect(() => {
    controller.current = new RadarPlayback((url, events) => {
      const layer = L.tileLayer(url, { maxNativeZoom: 7, maxZoom: 15, opacity: 0, zIndex: 300,
        keepBuffer: 1, updateWhenIdle: true, updateWhenZooming: false, className: 'radar-frame-layer',
        attribution: 'Weather radar by <a href="https://www.rainviewer.com/">RainViewer</a>' });
      layer.on(events);
      return { add: () => layer.addTo(map), setOpacity: value => layer.setOpacity(value), remove: () => { layer.off(); layer.remove(); } };
    }, state => callback.current(state));
    return () => { controller.current.destroy(); controller.current = null; };
  }, [map]);
  useEffect(() => { controller.current.update({frames,index,opacity,playing,host}); }, [frames,index,opacity,playing,host]);
  return null;
});
