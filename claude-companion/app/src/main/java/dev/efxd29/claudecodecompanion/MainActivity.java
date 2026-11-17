package dev.efxd29.claudecodecompanion;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView webView;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF1F1F1F);
        getWindow().setNavigationBarColor(0xFF1F1F1F);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);

        preferences = getSharedPreferences("claude_companion_connection", Context.MODE_PRIVATE);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF1F1F1F);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setDefaultTextEncodingName("UTF-8");

        webView.addJavascriptInterface(new NativeBridge(), "NativeBridge");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean isLoopbackUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            return "http".equals(uri.getScheme())
                    && ("127.0.0.1".equals(host) || "localhost".equals(host))
                    && uri.getPort() > 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String getConnectionConfig() {
            JSONObject result = new JSONObject();
            try {
                result.put("url", preferences.getString("url", "http://127.0.0.1:8765"));
                result.put("token", preferences.getString("token", ""));
            } catch (Exception ignored) {
            }
            return result.toString();
        }

        @JavascriptInterface
        public boolean saveConnection(String url, String token) {
            if (url == null || token == null || !isLoopbackUrl(url.trim()) || token.trim().length() < 24) {
                return false;
            }
            String normalized = url.trim().replaceAll("/+$", "");
            preferences.edit()
                    .putString("url", normalized)
                    .putString("token", token.trim())
                    .apply();
            return true;
        }

        @JavascriptInterface
        public void clearToken() {
            preferences.edit().remove("token").apply();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("NativeBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
