package io.github.jqssun.airplay.bridge;

import java.util.Map;

// JNI names and callback signatures follow android-airplay-server v0.0.36.
public abstract class NativeBridge {
    static { System.loadLibrary("airplay_native"); }
    public native long nativeInit(NativeBridge callbacks, byte[] id, String name, String key, boolean nohold, boolean pin);
    public native int nativeStart(long h, int port);
    public native void nativeStop(long h);
    public native void nativeDestroy(long h);
    public native void nativeSetDisplaySize(long h, int width, int height, int fps);
    public native void nativeSetH265Enabled(long h, boolean enabled);
    public native void nativeSetHlsEnabled(long h, boolean enabled);
    public native void nativeSetFeature(long h, int bit, boolean enabled);
    public native Map<String,String> nativeGetAirplayTxtRecords(long h);
    public native String nativeGetServerName(long h);
    public abstract void onVideoData(byte[] data, long timeNs, boolean hevc);
    public abstract void onMirrorRunning(boolean running);
    public abstract void onDisplayPin(String pin);
    public abstract void onVideoSize(float sw,float sh,float w,float h);
    public void onLog(String message) {}
    public void onConnectionInit() {}
    public void onConnectionDestroy() {}
    public void onConnectionReset(int reason) {}
    public void onAudioFormat(int ct,int spf,boolean screen) {}
    public void onClientVolume(float db) {}
    public float onClientVolumeQuery() { return -30f; }
    public void onAudioTeardown() {}
    public void onMetadata(byte[] data) {}
    public void onCoverArt(byte[] data) {}
    public void onProgress(long start,long current,long end) {}
    public void onDacpId(String id,String remote) {}
    public void onVideoPlay(String url,float position) {}
    public void onVideoScrub(float position) {}
    public void onVideoRate(float rate) {}
    public void onVideoStop() {}
    public void onVideoSessionPoll() {}
}
