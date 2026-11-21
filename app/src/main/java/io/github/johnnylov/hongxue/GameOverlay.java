package io.github.johnnylov.hongxue;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.*;
import android.hardware.display.*;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.*;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.*;
import android.webkit.WebView;
import android.widget.*;
import java.nio.ByteBuffer;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Runs only for a user-approved projection. The floating view reuses the open handbook and its roster. */
public final class GameOverlay extends Service {
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService analysis=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private HandlerThread frames;
    private Handler capture;
    private WindowManager wm;
    private WindowManager.LayoutParams layout;
    private LinearLayout window, bar;
    static final class Palette {
        final int bar, title, muted, accent, onAccent, paper;
        Palette() {
            bar=0xff251e3e; title=0xfff4f1ff; muted=0xffb9b0d6;
            accent=0xff6a52d9; onAccent=Color.WHITE; paper=Color.WHITE;
        }
        Palette(JSONObject colors) throws org.json.JSONException {
            bar=Color.parseColor(colors.getString("title-bg"));
            title=Color.parseColor(colors.getString("title-text"));
            muted=Color.parseColor(colors.getString("title-muted"));
            accent=Color.parseColor(colors.getString("accent"));
            onAccent=Color.parseColor(colors.getString("on-accent"));
            paper=Color.parseColor(colors.getString("paper"));
        }
    }
    private GradientDrawable surface(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }
    void applyPalette() {
        Palette colors = owner.palette;
        window.setBackground(surface(folded ? colors.bar : colors.paper, 12));
        bar.setBackgroundColor(colors.bar);
        handle.setTextColor(colors.title);
        for (Button b : new Button[]{advice,board,guide,stop}) {
            boolean chosen = b==advice && page==Page.ADVICE || b==board && page==Page.BOARD || b==guide && page==Page.GUIDE;
            int ink = chosen ? colors.onAccent : colors.muted;
            b.setSelected(chosen);
            b.setTextColor(ink);
            b.setTypeface(null, chosen ? Typeface.BOLD : Typeface.NORMAL);
            b.setBackground(new RippleDrawable(ColorStateList.valueOf((ink & 0xffffff) | 0x33000000),
                surface(chosen ? colors.accent : Color.TRANSPARENT, 8), surface(Color.WHITE, 8)));
        }
    }
    private TextView handle;
    private Button advice,board,guide,stop;
    private WebView web;
    private MainActivity owner;
    private MediaProjection projection;
    private VirtualDisplay display;
    private volatile ImageReader reader;
    private ShopOcr ocr;
    private volatile boolean closed;
    private enum Page { ADVICE, BOARD, GUIDE }
    private Page page=Page.BOARD;
    private boolean folded=true;
    private volatile int generation;
    private long sampled;
    private String finishMessage="已结束本机游戏识别";
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){
        super.onCreate();
        if(Build.VERSION.SDK_INT>=30){
            Display main=getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
            wm=createDisplayContext(main).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null).getSystemService(WindowManager.class);
        }else wm=getSystemService(WindowManager.class);
        frames=new HandlerThread("game-frames");frames.start();capture=new Handler(frames.getLooper());
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null || "stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(projection!=null)return START_NOT_STICKY;
        owner=MainActivity.overlayOwner.get();
        try{
            NotificationManager nm=getSystemService(NotificationManager.class);
            String channel="game-overlay";nm.createNotificationChannel(new NotificationChannel(channel,"本机游戏识别",NotificationManager.IMPORTANCE_LOW));
            PendingIntent end=PendingIntent.getService(this,1,new Intent(this,GameOverlay.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE);
            Notification note=new Notification.Builder(this,channel).setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("马头 · 游戏识别中")
                .setOngoing(true).setContentText("点此结束屏幕共享").setContentIntent(end).build();
            if(Build.VERSION.SDK_INT>=29)startForeground(31,note,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(31,note);
            if(owner==null || owner.isDestroyed())throw new IllegalStateException("请从手册重新开启悬浮窗");
            Intent consent=intent.getParcelableExtra("capture");
            projection=getSystemService(MediaProjectionManager.class).getMediaProjection(Activity.RESULT_OK,consent);
            if(projection==null)throw new IllegalStateException("未获得屏幕共享授权");
            projection.registerCallback(new MediaProjection.Callback(){
                @Override public void onStop(){stopSelf();}
                @Override public void onCapturedContentResize(int w,int h){resize(w,h);}
            },ui);
            showWindow();
            DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);resize(m.widthPixels,m.heightPixels);
            owner.moveTaskToBack(true);
        }catch(RuntimeException e){finishMessage="无法开启本机悬浮识别："+e.getClass().getSimpleName();stopSelf();}
        return START_NOT_STICKY;
    }
    private void showWindow(){
        window=new LinearLayout(this);window.setOrientation(LinearLayout.VERTICAL);window.setClipToOutline(true);
        bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);window.addView(bar);
        handle=new TextView(this);handle.setTypeface(null,Typeface.BOLD);handle.setGravity(Gravity.CENTER);handle.setPadding(dp(10),0,dp(10),0);
        bar.addView(handle,new LinearLayout.LayoutParams(-2,dp(40)));
        advice=barButton(bar,"建议",v->select(Page.ADVICE));
        board=barButton(bar,"站位",v->select(Page.BOARD));
        guide=barButton(bar,"攻略",v->select(Page.GUIDE));
        stop=barButton(bar,"结束",v->stopSelf());
        handle.setOnClickListener(v->{folded=!folded;updateWindow();});
        handle.setOnTouchListener(new View.OnTouchListener(){
            float x,y;int left,top;boolean drag;
            public boolean onTouch(View v,MotionEvent e){
                switch(e.getActionMasked()){
                case MotionEvent.ACTION_DOWN:x=e.getRawX();y=e.getRawY();left=layout.x;top=layout.y;drag=false;return true;
                case MotionEvent.ACTION_MOVE:
                    int dx=Math.round(e.getRawX()-x),dy=Math.round(e.getRawY()-y);
                    if(!drag && Math.abs(dx)+Math.abs(dy)<dp(6))return true;
                    drag=true;layout.x=left+dx;layout.y=top+dy;position();return true;
                case MotionEvent.ACTION_UP:if(!drag)v.performClick();return true;
                default:return true;
                }
            }});
        web=owner.detachForOverlay(this);window.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        layout=new WindowManager.LayoutParams(-2,-2,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|
            WindowManager.LayoutParams.FLAG_SECURE,PixelFormat.TRANSLUCENT);
        layout.gravity=Gravity.TOP|Gravity.LEFT;layout.x=dp(8);layout.y=dp(40);
        wm.addView(window,layout);updateWindow();
    }
    private Button barButton(LinearLayout bar,String name,View.OnClickListener action){
        Button button=new Button(this);button.setText(name);button.setSingleLine();
        button.setMinWidth(0);button.setMinimumWidth(0);button.setPadding(dp(3),0,dp(3),0);
        button.setAllCaps(false);button.setStateListAnimator(null);
        button.setOnClickListener(action);
        LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0,dp(40),1);
        cell.setMargins(dp(2),0,dp(2),0);
        bar.addView(button,cell);
        return button;
    }
    private void select(Page value){
        if(page==value)return;
        page=value;generation++;web.evaluateJavascript("Purchases.reset()",null);updateWindow();
    }
    private void position(){
        DisplayMetrics m=getResources().getDisplayMetrics();
        layout.x=Math.max(0,Math.min(layout.x,m.widthPixels-Math.max(dp(70),layout.width)));
        layout.y=Math.max(0,Math.min(layout.y,m.heightPixels-Math.max(dp(40),layout.height)));
        wm.updateViewLayout(window,layout);
    }
    private void updateWindow(){
        DisplayMetrics m=getResources().getDisplayMetrics();handle.setText(folded?"马头 ▸":"马头 ▾");
        for(Button b:new Button[]{advice,board,guide,stop}){
            b.setVisibility(folded?View.GONE:View.VISIBLE);
        }
        applyPalette();
        web.setVisibility(folded?View.GONE:View.VISIBLE);
        layout.width=folded?dp(74):Math.min(m.widthPixels,page==Page.ADVICE?dp(350):Math.min((int)(m.widthPixels*.93),page==Page.BOARD?dp(670):m.widthPixels));
        layout.height=folded?dp(40):Math.min((int)(m.heightPixels*.90),page==Page.ADVICE?dp(240):m.heightPixels);
        position();
        if(!folded)web.evaluateJavascript("PhoneMirror.overlayView('"+page.name().toLowerCase(java.util.Locale.ROOT)+"')",null);
    }
    @Override public void onConfigurationChanged(Configuration conf){
        super.onConfigurationChanged(conf);
        if(window!=null && window.isAttachedToWindow())updateWindow();
        if(Build.VERSION.SDK_INT<34 && projection!=null){
            DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);resize(m.widthPixels,m.heightPixels);
        }
    }
    private void resize(int originalW,int originalH){
        if(closed || projection==null || originalW<=0 || originalH<=0)return;
        float scale=Math.min(1f,1920f/Math.max(originalW,originalH));
        int w=Math.max(2,Math.round(originalW*scale)),h=Math.max(2,Math.round(originalH*scale));
        if(reader!=null && reader.getWidth()==w && reader.getHeight()==h)return;
        generation++;ImageReader old=reader;
        reader=ImageReader.newInstance(w,h,PixelFormat.RGBA_8888,2);
        reader.setOnImageAvailableListener(this::available,capture);
        int dpi=getResources().getDisplayMetrics().densityDpi;
        if(display==null)display=projection.createVirtualDisplay("Matou game",w,h,dpi,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,null);
        else{display.resize(w,h,dpi);display.setSurface(reader.getSurface());}
        if(old!=null){old.setOnImageAvailableListener(null,null);capture.post(old::close);}
    }
    private void available(ImageReader source){
        try(Image img=source.acquireLatestImage()){
            long now=SystemClock.elapsedRealtime();
            if(img==null || source!=reader || closed || busy.get() || now-sampled<450)return;
            sampled=now;int epoch=generation,w=img.getWidth(),h=img.getHeight();
            Image.Plane p=img.getPlanes()[0];ByteBuffer buf=p.getBuffer();
            int stride=p.getRowStride(),step=p.getPixelStride();byte[] bytes=new byte[buf.remaining()];buf.get(bytes);busy.set(true);
            analysis.execute(()->{
                Bitmap b=null;
                try{
                    if(closed)return;
                    int[] pixels=new int[w*h];
                    for(int y=0;y<h;y++)for(int x=0;x<w;x++){int i=y*stride+x*step;pixels[y*w+x]=0xff000000|(bytes[i]&255)<<16|(bytes[i+1]&255)<<8|(bytes[i+2]&255);}
                    b=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
                    if(ocr==null)ocr=new ShopOcr(this);JSONObject data=ocr.read(b);
                    ui.post(()->{if(!closed && generation==epoch)owner.localFrame(data);});
                }catch(Exception e){ui.post(()->{if(!closed)owner.localStatus("暂时读不清游戏画面");});}
                finally{if(b!=null)b.recycle();busy.set(false);}
            });
        }catch(IllegalStateException ignored){/* Reader replaced during rotation. */}
    }
    @Override public void onDestroy(){
        closed=true;generation++;
        if(display!=null)display.release();
        if(projection!=null)projection.stop();
        if(reader!=null){ImageReader old=reader;old.setOnImageAvailableListener(null,null);capture.post(old::close);}
        capture.post(()->{analysis.execute(()->{if(ocr!=null)ocr.close();});analysis.shutdown();});frames.quitSafely();
        if(web!=null && web.getParent()==window){window.removeView(web);web.setVisibility(View.VISIBLE);}
        if(window!=null && window.isAttachedToWindow())wm.removeView(window);
        if(owner!=null)owner.finishOverlay(finishMessage);
        stopForeground(true);super.onDestroy();
    }
}
