package io.github.johnnylov.hongxue;

import ai.onnxruntime.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import java.io.*;
import java.nio.FloatBuffer;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Offline PaddleOCR text detection and CTC recognition using the desktop model pair. */
final class ShopOcr implements AutoCloseable {
    private final OrtEnvironment env=OrtEnvironment.getEnvironment();
    private OrtSession detector,reader;
    private final List<String> alphabet=new ArrayList<>();
    private static final Pattern ROUND=Pattern.compile("回合[^0-9?？]{0,3}([0-9]{1,2})(?![0-9])");
    ShopOcr(Context context) throws Exception {
        try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){
            options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1);
            detector=open(context,"det.onnx",options);reader=open(context,"rec.onnx",options);
            try(BufferedReader lines=new BufferedReader(new InputStreamReader(context.getAssets().open("recognition/keys.txt"),"UTF-8"))){
                alphabet.add("");String s;while((s=lines.readLine())!=null)alphabet.add(s);alphabet.add(" ");
            }
        }catch(Exception e){close();throw e;}
    }
    private OrtSession open(Context ctx,String name,OrtSession.SessionOptions options) throws Exception {
        try(InputStream input=ctx.getAssets().open("recognition/"+name); ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] buf=new byte[32768];int size;while((size=input.read(buf))!=-1) bytes.write(buf,0,size);
            return env.createSession(bytes.toByteArray(),options);
        }
    }
    public void close(){try{if(reader!=null)reader.close();}catch(Exception ignored){}
        try{if(detector!=null)detector.close();}catch(Exception ignored){}}

    private float[][][][] detect(Bitmap img,Rect crop,int w,int h) throws Exception {
        try(OnnxTensor t=tensor(img,crop,w,h,true); OrtSession.Result out=detector.run(Collections.singletonMap("x",t))){
            return (float[][][][])out.get(0).getValue();
        }
    }
    private OnnxTensor tensor(Bitmap img,Rect r,int w,int h,boolean detection) throws OrtException {
        Bitmap sub=Bitmap.createBitmap(img,r.left,r.top,r.width(),r.height());
        Bitmap scaled=Bitmap.createScaledBitmap(sub,w,h,true);
        int n=w*h;int[] px=new int[n];scaled.getPixels(px,0,w,0,0,w,h);
        if(scaled!=img && scaled!=sub)scaled.recycle();if(sub!=img)sub.recycle();
        float[] input=new float[n*3];
        float[] mean={.485f,.456f,.406f},std={.229f,.224f,.225f};
        for(int c=0;c<3;c++)for(int i=0;i<n;i++){
            float v=((px[i]>>(8*c))&255)/255f;
            input[c*n+i]=detection?(v-mean[c])/std[c]:2*v-1;
        }
        return OnnxTensor.createTensor(env,FloatBuffer.wrap(input),new long[]{1,3,h,w});
    }
    private String line(Bitmap img,Rect r) throws Exception {
        if(!r.intersect(0,0,img.getWidth(),img.getHeight()) || r.width()<2 || r.height()<2)return "";
        int w=Math.max(12,Math.min(480,Math.round(48f*r.width()/r.height())));
        try(OnnxTensor t=tensor(img,r,w,48,false);OrtSession.Result res=reader.run(Collections.singletonMap("x",t))){
            float[][] steps=((float[][][])res.get(0).getValue())[0]; int prev=-1,count=0;float confidence=0;
            StringBuilder text=new StringBuilder();
            for(float[] step:steps){
                int best=0;for(int i=1;i<step.length;i++)if(step[i]>step[best])best=i;
                if(best!=0 && best!=prev && best<alphabet.size()){text.append(alphabet.get(best));confidence+=step[best];count++;}
                prev=best;
            }
            return count>0 && confidence/count>=.75f?Normalizer.normalize(text.toString(),Normalizer.Form.NFKC).replace(" ",""):"";
        }
    }
    private static final class Word {final Rect box;final String text;Word(Rect b,String t){box=b;text=t;}}
    private List<Word> words(Bitmap img,Rect band) throws Exception {
        float scale=Math.min(1.5f,1280f/band.width());
        int w=Math.max(32,Math.round(band.width()*scale/32)*32),h=Math.max(32,Math.round(band.height()*scale/32)*32);
        float[][] map=detect(img,band,w,h)[0][0];h=map.length;w=map[0].length;
        int[] queue=new int[w*h];List<Rect> boxes=new ArrayList<>();
        for(int y=0;y<h;y++)for(int x=0;x<w;x++){
            if(map[y][x]<.34f)continue;
            int head=0,tail=1,l=x,r=x,t=y,b=y;queue[0]=y*w+x;map[y][x]=0;
            while(head<tail){
                int p=queue[head++],cy=p/w,cx=p%w;l=Math.min(l,cx);r=Math.max(r,cx);t=Math.min(t,cy);b=Math.max(b,cy);
                for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
                    int nx=cx+dx,ny=cy+dy;
                    if(nx>=0 && nx<w && ny>=0 && ny<h && map[ny][nx]>=.34f){map[ny][nx]=0;queue[tail++]=ny*w+nx;}
                }
            }
            if(tail<5 || b-t<2 || r-l<2)continue;
            int pad=Math.max(2,Math.round(.42f*(b-t+1)));
            Rect box=new Rect(band.left+(l-pad)*band.width()/w,band.top+(t-pad)*band.height()/h,
                band.left+(r+pad+1)*band.width()/w,band.top+(b+pad+1)*band.height()/h);
            if(box.intersect(band))boxes.add(box);
        }
        boxes.sort(Comparator.comparingInt(a->a.left));List<Word> out=new ArrayList<>();
        for(Rect box:boxes){if(out.size()>=40)break;String s=line(img,box);if(!s.isEmpty())out.add(new Word(box,s));}
        return out;
    }
    private static Integer number(String s,int max){
        s=s.replace('O','0').replace('I','1').replace('l','1');
        if(!s.matches("[0-9]{1,2}"))return null;int v=Integer.parseInt(s);return v<=max?v:null;
    }
    private Integer badge(Bitmap img,int left,int y,float scale,int width,int max) throws Exception{
        Map<Integer,Integer> votes=new HashMap<>();
        for(int dy:new int[]{0,-3,3}){
            Rect box=new Rect(left,y+Math.round(dy*scale),left+Math.round(width*scale),y+Math.round((38+dy)*scale));
            Integer n=number(line(img,box),max);if(n!=null && votes.merge(n,1,Integer::sum)>=2)return n;
        }
        return null;
    }
    // Ignore encoded black margins around the phone display. Reject a portrait game surface.
    static Rect content(Bitmap img){
        int w=img.getWidth(),h=img.getHeight(),l=0,r=w,t=0,b=h;
        while(l<w/3 && dark(img,l,true) && dark(img,r-1,true)){l+=2;r-=2;}
        while(t<h/3 && dark(img,t,false) && dark(img,b-1,false)){t+=2;b-=2;}
        return new Rect(l,t,r,b);
    }
    private static boolean dark(Bitmap img,int p,boolean column){
        int n=column?img.getHeight():img.getWidth();
        for(int i=n/30;i<n;i+=Math.max(1,n/30)){
            int v=column?img.getPixel(p,i):img.getPixel(i,p);if((v&255)>22)return false;
        }return true;
    }
    JSONObject read(Bitmap img) throws Exception {
        JSONObject out=new JSONObject();Rect screen=content(img);
        int w=screen.width(),h=screen.height();if(w<1.25*h)return out;
        float s=Math.min(w/1920f,h/1080f);
        List<Word> top=words(img,new Rect(screen.left,screen.top,screen.left+(int)(w*.69),screen.top+(int)(h*.12)));
        for(Word word:top){
            Matcher m=ROUND.matcher(word.text);
            Integer round=m.find()?number(m.group(1),15):null;
            if(round==null && word.text.endsWith("回合")){
                round=number(line(img,new Rect(word.box.right,word.box.top,word.box.right+(int)(66*s),word.box.bottom)),15);
            }
            if(round!=null && round>=1){out.put("round",round);break;}
        }
        List<Word> bottom=words(img,new Rect(screen.left,screen.bottom-(int)(170*s),screen.right,screen.bottom));
        Word button=null;JSONArray labels=new JSONArray();
        for(Word word:bottom){
            if(word.box.centerX()<screen.left+w*.62 && (word.text.contains("升级") || word.text.contains("满级")))button=word;
        }
        if(button==null)return out;
        for(Word word:bottom){
            if(word.box.centerX()>button.box.right && word.box.centerY()>button.box.centerY()){
                JSONArray readings=new JSONArray().put(word.text.replaceFirst("^[*×✦✧]+",""));
                // A profession icon at the left of the label sometimes joins its first character.
                if(word.text.length()>2 && word.box.width()>word.box.height()*1.8){
                    Rect inner=new Rect(word.box);
                    inner.left+=Math.round(.82f*inner.height());readings.put(line(img,inner));
                }
                labels.put(readings);
            }
        }
        out.put("shop",labels);
        float k=(screen.bottom-button.box.top)/(101f*s)<1.04?s:s*10/9;
        int y=screen.bottom-Math.round(273*k),cx=button.box.centerX();
        out.put("money",badge(img,screen.right-Math.round(120*k),y,k,48,20));
        if(button.text.contains("满级"))out.put("terminal",6);
        else{
            out.put("upgrade",badge(img,cx-Math.round(26*k),y,k,52,40));
            int lightSamples=0;
            for(int dx=-30;dx<=30;dx+=10)for(int dy=145;dy<=185;dy+=10){
                int v=img.getPixel(Math.max(screen.left,Math.min(screen.right-1,cx+Math.round(dx*k))),screen.bottom-Math.round(dy*k))&255;
                if(v>145)lightSamples++;
            }
            boolean dark=lightSamples>=18;
            int shape=TerminalGlyph.read(img,cx,screen.bottom,k,dark);
            if(shape>0){out.put("terminal",shape);return out;}
            List<Word> level=words(img,new Rect(Math.max(screen.left,cx-(int)(85*s)),screen.bottom-(int)(240*s),
                Math.min(screen.right,cx+(int)(85*s)),screen.bottom-(int)(112*s)));
            for(Word row:level){
                String roman=row.text.replace("LEVEL","").replace('l','I').replace('1','I').replace('|','I');
                int n=Arrays.asList("","I","II","III","IV","V","VI").indexOf(roman);
                if(n>0){out.put("terminal",n);break;}
            }
        }
        return out;
    }
}
