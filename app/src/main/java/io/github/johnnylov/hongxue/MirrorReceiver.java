package io.github.johnnylov.hongxue;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.LinkAddress;
import android.net.NetworkCapabilities;
import java.net.InetAddress;
import java.net.Inet4Address;
import javax.jmdns.JmDNS;
import javax.jmdns.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import android.util.Base64;
import io.github.jqssun.airplay.bridge.NativeBridge;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

final class MirrorReceiver extends NativeBridge {
    interface Listener { void update(MirrorReceiver source,String event,Object value); }
    private final Context context;
    private final Listener listener;
    private final NsdManager nsd;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean reading=new AtomicBoolean();
    private final ExecutorService decoder=Executors.newSingleThreadExecutor();
    private final java.util.concurrent.Semaphore videoSlots=new java.util.concurrent.Semaphore(12);
    private final AtomicBoolean awaitKeyframe=new AtomicBoolean();
    private MediaCodec codec;
    private ShopOcr ocr;
    private long handle, lastFrame, lastPacketNotice;
    private int width=1920,height=1080;
    private volatile int generation;
    private volatile boolean closed;
    private WifiManager.MulticastLock lock;
    private WifiManager.WifiLock wifiLock;
    private NsdManager.RegistrationListener registration;
    private final ExecutorService discovery=Executors.newSingleThreadExecutor();
    private JmDNS fallback;

    private synchronized void advertiseDirect(String name,int port,Map<String,String> txt) {
        if(closed)return;
        discovery.execute(()->{
            if(closed)return;
            try{
                ConnectivityManager net=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
                for(android.net.Network network:net.getAllNetworks()){
                    NetworkCapabilities caps=net.getNetworkCapabilities(network);
                    LinkProperties props=net.getLinkProperties(network);
                    if(props==null || caps==null || !(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)))continue;
                    for(LinkAddress address:props.getLinkAddresses()){
                        InetAddress ip=address.getAddress();
                        if(!(ip instanceof Inet4Address) || ip.isLoopbackAddress())continue;
                        fallback=JmDNS.create(ip,name);
                        ServiceInfo service=ServiceInfo.create("_airplay._tcp.local.",name,port,0,0,txt);
                        fallback.registerService(service);
                        emit("name",service.getName());return;
                    }
                }
                emit("error","平板还没有可用的 Wi-Fi 或以太网地址");
            }catch(Exception | LinkageError e){emit("error","局域网发现失败："+e.getMessage());}
        });
    }

    MirrorReceiver(Context ctx,Listener sink) {
        context=ctx.getApplicationContext(); listener=sink;
        nsd=(NsdManager)context.getSystemService(Context.NSD_SERVICE);
    }
    private void emit(String event,Object value) { if(!closed) listener.update(this,event,value); }

    void start() {
        SharedPreferences prefs=context.getSharedPreferences("mirror",0);
        String saved=prefs.getString("deviceId",null);
        byte[] id;
        if(saved==null) {
            id=new byte[6]; new SecureRandom().nextBytes(id); id[0]=(byte)((id[0]&252)|2);
            prefs.edit().putString("deviceId",Base64.encodeToString(id,Base64.NO_WRAP)).apply();
        } else id=Base64.decode(saved,Base64.DEFAULT);
        handle=nativeInit(this,id,"Matou-"+String.format(java.util.Locale.ROOT,"%02X%02X",id[4],id[5]),
            new File(context.getFilesDir(),"mirror.key").getPath(),false,true);
        if(handle==0) throw new IllegalStateException("无法初始化投屏接收器");
        nativeSetDisplaySize(handle,1920,1080,30);
        nativeSetPlist(handle,"maxFPS",30);
        nativeSetH265Enabled(handle,false);
        nativeSetHlsEnabled(handle,false);
        nativeSetFeature(handle,7,true);
        nativeSetFeature(handle,9,false);
        int port=nativeStart(handle,0);
        if(port<1) throw new IllegalStateException("投屏端口不可用");
        WifiManager wifi=(WifiManager)context.getSystemService(Context.WIFI_SERVICE);
        lock=wifi.createMulticastLock("matou-airplay"); lock.acquire();
        wifiLock=wifi.createWifiLock(android.os.Build.VERSION.SDK_INT>=29?WifiManager.WIFI_MODE_FULL_LOW_LATENCY:WifiManager.WIFI_MODE_FULL_HIGH_PERF,"matou-video");
        wifiLock.acquire();
        NsdServiceInfo info=new NsdServiceInfo();
        info.setServiceName(nativeGetServerName(handle)); info.setServiceType("_airplay._tcp"); info.setPort(port);
        Map<String,String> txt=nativeGetAirplayTxtRecords(handle);
        for(Map.Entry<String,String> pair:txt.entrySet()) info.setAttribute(pair.getKey(),pair.getValue());
        registration=new NsdManager.RegistrationListener(){
            public void onServiceRegistered(NsdServiceInfo s){emit("name",s.getServiceName());}
            public void onRegistrationFailed(NsdServiceInfo s,int code){advertiseDirect(info.getServiceName(),port,txt);}
            public void onServiceUnregistered(NsdServiceInfo s){}
            public void onUnregistrationFailed(NsdServiceInfo s,int code){}
        };
        nsd.registerService(info,NsdManager.PROTOCOL_DNS_SD,registration);
    }
    synchronized void close() {
        if(closed)return;
        closed=true;
        if(registration!=null) try{nsd.unregisterService(registration);}catch(IllegalArgumentException ignored){}
        discovery.execute(()->{if(fallback!=null)try{fallback.close();}catch(java.io.IOException ignored){}});
        discovery.shutdown();
        if(lock!=null && lock.isHeld())lock.release();
        if(wifiLock!=null && wifiLock.isHeld())wifiLock.release();
        if(handle!=0){nativeStop(handle);nativeDestroy(handle);handle=0;}
        decoder.execute(()->{resetCodec();worker.execute(()->{if(ocr!=null)ocr.close();});worker.shutdown();});
        decoder.shutdown();
    }
    public void onDisplayPin(String pin){emit("pin",pin);}
    public void onConnectionReset(int reason){emit("reset",reason);}
    public void onMirrorRunning(boolean active){
        if(closed)return;
        if(!active)decoder.execute(()->{generation++;resetCodec();awaitKeyframe.set(false);});
        emit("stream",active);
    }
    public void onVideoSize(float sw,float sh,float w,float h){
        if(!closed)decoder.execute(()->{if(w>0 && h>0 && ((int)w!=width || (int)h!=height)){
            width=(int)w;height=(int)h; generation++;resetCodec();}});
    }
    private void resetCodec(){if(codec!=null){try{codec.release();}catch(RuntimeException ignored){} codec=null;}}
    public void onVideoData(byte[] data,long timeNs,boolean hevc) {
        if(closed || hevc || data.length==0)return;
        long now=SystemClock.elapsedRealtime();
        if(now-lastPacketNotice>2000){lastPacketNotice=now;emit("packet",true);}
        if(awaitKeyframe.get() && !syncPacket(data))return;
        if(!videoSlots.tryAcquire()){awaitKeyframe.set(true);return;}
        awaitKeyframe.set(false);
        decoder.execute(()->{
            try {
                if(closed)return;
                if(codec==null) {
                    codec=MediaCodec.createDecoderByType("video/avc");
                    MediaFormat format=MediaFormat.createVideoFormat("video/avc",width,height);
                    format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
                    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE,4*1024*1024);
                    codec.configure(format,null,null,0); codec.start();
                }
                drain();
                int idx=codec.dequeueInputBuffer(8000);
                if(idx>=0){
                    ByteBuffer buffer=codec.getInputBuffer(idx);buffer.clear();
                    if(buffer.remaining()<data.length)throw new IllegalArgumentException("视频帧过大");
                    buffer.put(data);codec.queueInputBuffer(idx,0,data.length,timeNs/1000,0);
                }else awaitKeyframe.set(true);
                drain();
            } catch(Exception e){resetCodec();awaitKeyframe.set(true);emit("status","视频解码恢复中，等待关键帧");}
            finally{videoSlots.release();}
        });
    }
    private boolean syncPacket(byte[] data){
        for(int i=2;i+1<data.length;i++)if(data[i]==1 && data[i-1]==0 && data[i-2]==0){
            int type=data[i+1]&31;if(type==5 || type==7 || type==8)return true;
        }
        return false;
    }
    private void drain() {
        MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
        for(int i=0;i<8;i++){
            int idx=codec.dequeueOutputBuffer(info,0);
            if(idx==MediaCodec.INFO_TRY_AGAIN_LATER)return;
            if(idx<0)continue;
            try {
                long now=SystemClock.elapsedRealtime();
                if(now-lastFrame<900 || reading.get() || info.size==0) continue;
                try(Image frame=codec.getOutputImage(idx)){
                    if(frame==null)continue;
                    Frame image=new Frame(frame);
                    lastFrame=now; reading.set(true);int epoch=generation;
                    worker.execute(()->recognize(image,epoch));
                }
            } finally{codec.releaseOutputBuffer(idx,false);}
        }
    }
    private void recognize(Frame frame,int epoch){
        Bitmap image=null;
        try {
            if(closed)return;
            image=frame.bitmap();
            if(ocr==null)ocr=new ShopOcr(context);
            JSONObject result=ocr.read(image);
            if(!closed && generation==epoch)emit("frame",result);
        }catch(Exception e){emit("status","识别失败："+e.getClass().getSimpleName());}
        finally{if(image!=null)image.recycle();reading.set(false);}
    }
    private static final class Frame {
        final Rect crop;final byte[][] bytes=new byte[3][];final int[] row=new int[3],step=new int[3];
        Frame(Image image){
            crop=new Rect(image.getCropRect());
            for(int c=0;c<3;c++){
                Image.Plane plane=image.getPlanes()[c];ByteBuffer b=plane.getBuffer();
                bytes[c]=new byte[b.remaining()];b.get(bytes[c]);
                row[c]=plane.getRowStride();step[c]=plane.getPixelStride();
            }
        }
        int clip(int v){return Math.max(0,Math.min(255,v>>8));}
        Bitmap bitmap(){
            int w=crop.width(),h=crop.height();int[] pixels=new int[w*h];
            for(int y=0;y<h;y++)for(int x=0;x<w;x++){
                int px=x+crop.left,py=y+crop.top;
                int l=298*((bytes[0][py*row[0]+px*step[0]]&255)-16)+128;
                int u=(bytes[1][py/2*row[1]+px/2*step[1]]&255)-128,v=(bytes[2][py/2*row[2]+px/2*step[2]]&255)-128;
                pixels[y*w+x]=0xff000000|(clip(l+409*v)<<16)|(clip(l-100*u-208*v)<<8)|clip(l+516*u);
            }
            return Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
        }
    }
}
