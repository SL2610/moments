package com.grabpic.api.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

@Data
@AllArgsConstructor
public class PhotoResponse {
    private String id;
    private String viewUrl;      // original (used for downloads)
    private String previewUrl;   // optimized fullscreen preview
    private String thumbUrl;     // gallery-grid thumbnail

    @JsonProperty("isPublic")
    private boolean isPublic;

    private boolean processed;
    private int faceCount;
    private List<String> faceBoxes;
}
