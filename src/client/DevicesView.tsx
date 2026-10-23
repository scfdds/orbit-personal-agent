import { useEffect, useState } from "react";
import { ArrowRight, Cloud, FolderOpen, Laptop } from "lucide-react";
import type { ExecutionDevice } from "../shared/types.ts";
import { SurfaceHeader } from "./SurfaceHeader.tsx";
import { Modal } from "./ui.tsx";
import { request } from "./api.ts";
import "./devices.css";

export function useExecutionDevice(enabled: boolean, online: boolean) {
  const [device, setDevice] = useState<ExecutionDevice | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !online) return;
    let cancelled = false;
    setError(false);
    void request<ExecutionDevice>("/devices/local")
      .then(value => {
        if (!cancelled) setDevice(value);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [enabled, online, attempt]);
  return { device, error, retry: () => setAttempt(value => value + 1) };
}

type DeviceState = ReturnType<typeof useExecutionDevice> & { online: boolean };
function LocalDevice({ device, online, error, retry, compact = false }: DeviceState & { compact?: boolean }) {
  const status = !online ? "连接中断" : error ? "状态未获取" : device ? "在线" : "正在连接…";
  return <section className={`device-card local-device ${compact ? "compact" : ""}`} aria-label="本地电脑">
    <div className="device-card-heading">
      <span className="device-symbol"><Laptop size={23} strokeWidth={1.6}/></span>
      <div className="device-identity"><h2>本地电脑 <span className="device-current">当前使用</span></h2>
        <p>{device ? `${device.name} · ${device.platform}` : !online ? "等待本地服务重新连接" : error ? "设备信息暂不可用" : "设备信息获取中…"}</p>
      </div>
      <span className={`device-status ${online && !error && device ? "online" : ""}`} role="status"><i/>{status}</span>
    </div>
    {!compact && device && <dl className="device-properties"><div><dt><FolderOpen size={15}/>工作目录</dt><dd>{device.workspaceRoot}</dd></div></dl>}
    {error && <div className="device-fetch-error" role="alert"><span>暂时无法获取设备信息。</span><button onClick={retry}>重试</button></div>}
    <p className="device-note">自动任务需要这台电脑和 Orbit 服务保持运行。</p>
  </section>;
}

export default function DevicesView({ onNotify, ...state }: DeviceState & { onNotify: (message: string) => void }) {
  return <>
    <SurfaceHeader title="执行设备"/>
    <div className="devices-scroll"><div className="devices-content">
      <LocalDevice {...state}/>
      <section className="device-card cloud-device" aria-label="云端电脑">
        <div className="device-card-heading">
          <span className="device-symbol"><Cloud size={23} strokeWidth={1.6}/></span>
          <div className="device-identity"><h2>云端电脑</h2><p>连接后，可在本机关闭时继续执行。</p></div>
          <span className="device-status">未连接</span>
        </div>
        <div className="device-card-actions"><button className="button secondary" onClick={() => onNotify("云端电脑暂未开放连接。当前任务仍在本地执行。")}>连接云端电脑</button></div>
      </section>
    </div></div>
  </>;
}

export function CurrentDeviceDialog({ onClose, onManage, ...state }: DeviceState & { onClose: () => void; onManage: () => void }) {
  return <Modal title="当前执行设备" onClose={onClose}>
    <div className="current-device-dialog"><LocalDevice {...state} compact/>
      <button className="manage-devices" onClick={onManage}>管理执行设备 <ArrowRight size={15}/></button>
    </div>
  </Modal>;
}
