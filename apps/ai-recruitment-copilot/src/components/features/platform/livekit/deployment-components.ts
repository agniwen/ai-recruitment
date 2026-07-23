export interface DeploymentComponent {
  details: { label: string; value: string }[];
  endpoint: string;
  id: string;
  name: string;
  role: string;
}

// Generic operational facts based on LiveKit's self-hosting documentation.
// Deployment-specific credentials, domains, filesystem paths, and origin IPs
// are intentionally excluded so this fork can keep its own infrastructure.
export const LIVEKIT_DEPLOYMENT_COMPONENTS: DeploymentComponent[] = [
  {
    details: [
      { label: "容器镜像", value: "livekit/livekit-server:latest" },
      { label: "信令入口", value: "HTTPS/WSS 反向代理 → HTTP 7880" },
      { label: "RTC TCP Fallback", value: "TCP 7881" },
      { label: "RTC UDP", value: "UDP 50000-60000" },
    ],
    endpoint: "由 LIVEKIT_URL 配置",
    id: "livekit-server",
    name: "LiveKit Server",
    role: "信令与 WebRTC 媒体服务",
  },
  {
    details: [
      { label: "容器镜像", value: "redis:7-alpine" },
      { label: "持久化", value: "按部署平台配置，生产环境建议开启" },
      { label: "暴露建议", value: "生产环境不向公网开放 6379" },
    ],
    endpoint: "由 LiveKit Server 配置",
    id: "redis",
    name: "Redis",
    role: "实时房间与会话状态",
  },
  {
    details: [
      { label: "STUN/TURN", value: "UDP 3478" },
      { label: "TURNS", value: "TLS 5349" },
      { label: "证书与域名", value: "由 LiveKit Server 配置" },
    ],
    endpoint: "由 LiveKit Server 配置",
    id: "turn",
    name: "TURN",
    role: "弱网与受限网络媒体中继",
  },
  {
    details: [
      { label: "采集端口", value: "TCP 6789" },
      { label: "Platform 配置", value: "LIVEKIT_PROMETHEUS_URL" },
      { label: "访问建议", value: "仅允许应用服务器或监控网络访问" },
    ],
    endpoint: "/metrics",
    id: "prometheus",
    name: "Prometheus Endpoint",
    role: "LiveKit 运行指标采集",
  },
];
