package io.github.johnnylov.hongxue;

import android.graphics.Bitmap;
import java.util.*;

// Android port of the desktop TerminalLevelReader.RomanNumeralShape (Apache-2.0).
final class TerminalGlyph {
    private static final class Stroke {
        int left,right,height;
        double top,bottom,slope;
    }
    static int read(Bitmap image,int cx,int bottom,float scale,boolean dark) {
        int cw=(int)((dark?160:120)*scale),ch=(int)((dark?110:95)*scale);
        int x=cx-cw/2+(int)(cw*.12),y=bottom-(int)((dark?235:210)*scale)+(int)(ch*.10);
        int w=(int)(cw*.88)-(int)(cw*.12),h=(int)(ch*.92)-(int)(ch*.10);
        if(w<8 || h<8 || x<0 || y<0 || x+w>image.getWidth() || y+h>image.getHeight())return 0;
        int[] val=new int[w*h];image.getPixels(val,0,w,x,y,w,h);
        for(int i=0;i<val.length;i++)val[i]&=255;
        int[] sorted=val.clone();Arrays.sort(sorted);
        int low=sorted[val.length/100],high=sorted[(int)(val.length*.99)];
        if(high-low<36)return 0;
        boolean[] mask=new boolean[val.length];
        for(int i=0;i<val.length;i++)mask[i]=dark?val[i]<=low+60:val[i]>=high-35;
        List<Stroke> strokes=new ArrayList<>();int highest=0;
        int[] pts=new int[val.length];
        for(int start=0;start<val.length;start++){
            if(!mask[start])continue;
            int head=0,n=1,minX=w,minY=h,maxX=0,maxY=0;pts[0]=start;mask[start]=false;
            while(head<n){
                int p=pts[head++],px=p%w,py=p/w;
                minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
                for(int dy=-2;dy<=2;dy++)for(int dx=-1;dx<=1;dx++){
                    int nx=px+dx,ny=py+dy;
                    if(nx<0 || ny<0 || nx>=w || ny>=h)continue;
                    int at=ny*w+nx;if(mask[at]){mask[at]=false;pts[n++]=at;}
                }
            }
            int sh=maxY-minY+1,sw=maxX-minX+1;
            if(sw>2*sh || sh<(int)(.18*h) || sw>.7*w || minX==0 || maxX==w-1 || n<.75*sh)continue;
            int band=Math.max(1,sh/4);
            double[] top=rows(pts,n,w,minY,minY+band),bot=rows(pts,n,w,maxY-band,maxY);
            Stroke st=new Stroke();st.left=minX;st.right=maxX;st.height=sh;st.top=top[0];st.bottom=bot[0];st.slope=(bot[1]-top[1])/sh;
            strokes.add(st);highest=Math.max(highest,sh);
        }
        final double limit=.7*highest;strokes.removeIf(st->st.height<limit);strokes.sort(Comparator.comparingInt(st->st.left));
        StringBuilder result=new StringBuilder();
        for(int i=0;i<strokes.size();i++){
            Stroke st=strokes.get(i);
            if(st.top>1.7*st.bottom && st.top>.65*st.height)result.append('V');
            else if(i+1<strokes.size() && st.slope>.2 && strokes.get(i+1).slope<-.2 && strokes.get(i+1).left-st.right<.6*st.height){result.append('V');i++;}
            else result.append('I');
        }
        return Arrays.asList("","I","II","III","IV","V","VI").indexOf(result.toString());
    }
    private static double[] rows(int[] pts,int count,int w,int lo,int hi){
        int[] first=new int[hi-lo+1],last=new int[first.length];Arrays.fill(first,w);
        int sum=0,n=0;
        for(int i=0;i<count;i++){
            int row=pts[i]/w-lo;if(row<0 || row>=first.length)continue;
            int x=pts[i]%w;first[row]=Math.min(first[row],x);last[row]=Math.max(last[row],x);sum+=x;n++;
        }
        int widths=0,rows=0;
        for(int i=0;i<first.length;i++)if(first[i]<w){widths+=last[i]-first[i]+1;rows++;}
        return new double[]{widths/(double)Math.max(1,rows),sum/(double)Math.max(1,n)};
    }
}
