async function getFreePorts() {
  const portfinder = await import('portfinder');
  const rtpPort = await portfinder.getPortPromise({ port: 40000 }); // start range
  const rtcpPort = rtpPort + 1;
  return { rtpPort, rtcpPort };
}
