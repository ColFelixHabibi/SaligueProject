package com.indeciana.saligue;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalleryPlugin.class);
        super.onCreate(savedInstanceState);

        // The phone's back button, like in TikTok or a browser: first closes what is open (a menu, comments, a
        // sheet), then goes back to the page before, and on the first page puts the app in the background
        // instead of closing it (so it opens again where you were).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() == null ? null : getBridge().getWebView();
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript("(function(){try{return !!(window.__saligueBack&&window.__saligueBack())}catch(e){return false}})()", value -> {
                    if ("true".equals(value)) return;
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }
}
