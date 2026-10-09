export function microphoneErrorHelp(error: Error): { title: string; help: string } {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError": {
      return {
        help: "请在浏览器地址栏的网站权限中允许麦克风，并检查系统是否允许浏览器使用麦克风，然后重新开启。",
        title: "麦克风权限未开放",
      };
    }
    case "NotFoundError":
    case "DevicesNotFoundError": {
      return {
        help: "请连接麦克风，或在系统的输入设备设置中选择可用设备。",
        title: "未检测到麦克风",
      };
    }
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError": {
      return {
        help: "请检查系统麦克风权限、关闭可能占用麦克风的其他程序，或选择其他麦克风后重试。",
        title: "麦克风无法使用",
      };
    }
    case "OverconstrainedError": {
      return { help: "请检查系统的输入设备设置，选择可用设备后重试。", title: "所选麦克风不可用" };
    }
    case "NotSupportedError": {
      return {
        help: "请使用支持音视频的浏览器，并通过 HTTPS 打开会议链接。",
        title: "当前环境无法使用麦克风",
      };
    }
    default: {
      return { help: "请检查麦克风设备和网络连接，然后重新开启。", title: "麦克风开启失败" };
    }
  }
}

export async function checkMeetingMicrophone(): Promise<Error | null> {
  let stream: MediaStream | undefined;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return new DOMException("Microphone capture is unavailable", "NotSupportedError");
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      return new DOMException("No microphone track", "NotFoundError");
    }
    if (tracks.every((track) => track.readyState === "ended")) {
      return new DOMException("Microphone track has ended", "NotReadableError");
    }
    return null;
  } catch (error) {
    return error instanceof Error || error instanceof DOMException
      ? error
      : new Error("麦克风检测失败");
  } finally {
    // Preflight never publishes or retains audio, including after navigation away.
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  }
}
