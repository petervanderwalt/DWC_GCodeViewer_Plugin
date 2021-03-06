/*eslint no-useless-escape: 0*/
'use strict';

import * as BABYLON from 'babylonjs';
import gcodeLine from './gcodeline';

export const RenderMode = {
  Block: 1,
  Line: 2,
  Point: 3,
  Max: 4,
};

export default class {
  constructor() {
    this.currentPosition = new BABYLON.Vector3(0, 0, 0);
    this.currentColor = new BABYLON.Color4(1, 1, 1, 1);
    this.renderVersion = RenderMode.Line;
    this.absolute = true; //Track if we are in relative or absolute mode.

    this.lines = [];
    this.travels = [];
    this.sps;
    this.maxHeight = 0;
    this.lineCount = 0;
    this.renderMode = '';
    this.extruderCount = 5;

    this.layerDictionary = {};

    //We'll look at the last 2 layer heights for now to determine layer height.
    this.previousLayerHeight = 0;
    this.currentLayerHeight = 0;

    //Live Rendering
    this.liveTracking = false;
    this.materialTransparency = 0.2;
    this.gcodeLineIndex = [];
    this.gcodeLineNumber = 0;

    this.refreshTime = 5000;

    this.lineLengthTolerance = 0.05;

    this.extruderColors = [
      new BABYLON.Color4(0, 1, 1, 1), //c
      new BABYLON.Color4(1, 0, 1, 1), //m
      new BABYLON.Color4(1, 1, 0, 1), //y
      new BABYLON.Color4(0, 0, 0, 1), //k
      new BABYLON.Color4(1, 1, 1, 1), //w
    ];

    //scene data
    this.lineMeshIndex = 0;
    this.scene;
    this.renderFuncs = [];

    //Mesh Breaking
    this.meshBreakPoint = 20000;

    //average feed rate trimming
    this.feedRateTrimming = false;
    this.currentFeedRate = 0;
    this.feedValues = 0;
    this.numChanges = 0;
    this.avgFeed = 0;
    this.underspeedPercent = 1;

    //render every nth row
    this.everyNthRow = 0;
    this.currentRowIdx = -1;
    this.currentZ = 0;

    this.renderTravels = false;

    this.forceWireMode = false;

    this.enableTransparency = false;
    this.lineVertexAlpha = true;
    this.spreadLines = false;
    this.spreadLineAmount = 10;
    this.debug = false;
  }

  setExtruderColors(colors) {
    if (colors === null || colors.length === 0) return;
    this.extruderColors = [];
    for (var idx = 0; idx < colors.length; idx++) {
      var color = colors[idx];
      if (color.length < 8) {
        color = color + 'FF';
      }
      var extruderColor = BABYLON.Color4.FromHexString(color);
      this.extruderColors.push(extruderColor);
    }
  }

  getMaxHeight() {
    return this.maxHeight;
  }

  setRenderQualitySettings(numberOfLines, renderQuality) {
    if (renderQuality === undefined) {
      renderQuality = 1;
    }

    let maxLines = 0;
    let renderStartIndex = this.forceWireMode ? 2 : 1;
    let maxNRow = 2;

    this.refreshTime = 5000;
    this.everyNthRow = 1;

    //Render Mode Multipliers
    // 12x - 3d
    // 2x - line
    // 1x - point

    switch (renderQuality) {
      //SBC Quality - Pi 3B+
      case 1:
        {
          renderStartIndex = 2;
          this.refreshTime = 30000;
          maxLines = 25000;
          maxNRow = 50;
        }
        break;
      //Low Quality
      case 2:
        {
          renderStartIndex = 2;
          this.refreshTime = 30000;
          maxLines = 500000;
          maxNRow = 10;
        }
        break;
      //Medium Quality
      case 3:
        {
          maxLines = 1000000;
          maxNRow = 3;
        }
        break;
      //High Quality
      case 4:
        {
          maxLines = 15000000;
          maxNRow = 2;
        }
        break;
      //Ultra
      case 5:
        {
          maxLines = 25000000;
        }
        break;
      //Max
      default: {
        this.renderVersion = RenderMode.Block;
        this.everyNthRow = 1;
        return;
      }
    }

    for (let renderModeIdx = renderStartIndex; renderModeIdx < 4; renderModeIdx++) {
      let vertextMultiplier;
      switch (renderModeIdx) {
        case 1:
          vertextMultiplier = 24;
          break;
        case 2:
          vertextMultiplier = 2;
          break;
        case 3:
          vertextMultiplier = 1;
          break;
      }

      for (let idx = this.everyNthRow; idx <= maxNRow; idx++) {
        if (this.debug) {
          console.log('Mode: ' + renderModeIdx + '  NRow: ' + idx + '   vertexcount: ' + (numberOfLines * vertextMultiplier) / idx);
        }
        if ((numberOfLines * vertextMultiplier) / idx < maxLines) {
          this.renderVersion = renderModeIdx;
          this.everyNthRow = idx;
          return;
        }
      }
    }

    //we couldn't find a working case so we'll set a triage value
    console.log('Worst Case');
    this.renderVersion = 2;
    this.everyNthRow = 20;
  }

  processGcodeFile(file, renderQuality, clearCache) {
    this.currentZ = 0;
    this.currentRowIdx = -1;
    this.gcodeLineIndex = [];
    this.lineMeshIndex = 0;
    this.lastExtrudedZHeight = 0;
    this.previousLayerHeight = 0;
    this.currentLayerHeight = 0;

    if (renderQuality === undefined || renderQuality === null) {
      renderQuality = 4;
    }

    if (file === undefined || file === null || file.length === 0) {
      return;
    }
    var lines = file.split(/\r\n|\n/);

    //Get an opportunity to free memory before we strt generating 3d model
    if (typeof clearCache === 'function') {
      clearCache();
    }

    this.lineCount = lines.length;
    this.setRenderQualitySettings(this.lineCount, renderQuality);

    //set initial color to extruder 0
    this.currentColor = this.extruderColors[0].clone();

    /*
    for (var lineNo = 0; lineNo < lines.length; lineNo++) {
      var line = lines[lineNo];
      line.trim();
      if (!line.startsWith(';')) {
        this.processLine(line, lineNo);
      }
    }
*/
    lines.reverse();
    let lineNo = 0;
    while (lines.length) {
      lineNo++;
      var line = lines.pop();
      line.trim();
      if (!line.startsWith(';')) {
        this.processLine(line, lineNo);
      }
    }

    file = {}; //Clear1 out the file.
  }

  processLine(tokenString, lineNumber) {
    //Remove the comments in the line
    let commentIndex = tokenString.indexOf(';');
    if (commentIndex > -1) {
      tokenString = tokenString.substring(0, commentIndex - 1).trim();
    }

    let tokens = tokenString.toUpperCase().split(' ');
    if (tokens.length > 1) {
      switch (tokens[0]) {
        case 'G0':
        case 'G1':
          var line = new gcodeLine();
          line.gcodeLineNumber = lineNumber;
          line.start = this.currentPosition.clone();
          for (let tokenIdx = 1; tokenIdx < tokens.length; tokenIdx++) {
            let token = tokens[tokenIdx];
            switch (token[0]) {
              case 'X':
                this.currentPosition.x = this.absolute ? Number(token.substring(1)) : this.currentPosition.x + Number(token.substring(1));
                break;
              case 'Y':
                this.currentPosition.z = this.absolute ? Number(token.substring(1)) : this.currentPosition.z + Number(token.substring(1));
                break;
              case 'Z':
                this.currentPosition.y = this.absolute ? Number(token.substring(1)) : this.currentPosition.y + Number(token.substring(1));
                if (this.spreadLines) {
                  this.currentPosition.y *= this.spreadLineAmount;
                }
                this.maxHeight = this.currentPosition.y;
                break;
              case 'E':
                line.extruding = true;
                break;
              case 'F':
                this.currentFeedRate = Number(token.substring(1));
                break;
            }
          }

          line.end = this.currentPosition.clone();

          if (this.feedRateTrimming) {
            this.feedValues += this.currentFeedRate;
            this.numChanges++;
            this.avgFeed = (this.feedValues / this.numChanges) * this.underspeedPercent;
          }

          //Nth row exclusion
          if (this.everyNthRow > 1 && line.extruding) {
            if (this.currentPosition.y > this.currentZ) {
              this.currentRowIdx++;
              this.currentZ = this.currentPosition.y;
            }

            if ((this.currentRowIdx % this.everyNthRow !== 0) ^ (this.currentRowIdx < 2)) {
              return;
            }
          }

          if (line.extruding && line.length() >= this.lineLengthTolerance && (!this.feedRateTrimming || this.currentFeedRate < this.avgFeed) && (this.showTravels || line.extruding)) {
            line.color = this.currentColor.clone();
            this.lines.push(line);
            if (this.currentPosition.y > this.currentLayerHeight && this.currentPosition.y < 20) {
              this.previousLayerHeight = this.currentLayerHeight;
              this.currentLayerHeight = this.currentPosition.y;
            }
          } else if (this.showTravels && !line.extruding) {
            line.color = new BABYLON.Color4(1, 0, 0, 1);
            this.travels.push(line);
          }
          break;
        case 'G28':
          //Home
          this.currentPosition = new BABYLON.Vector3(0, 0, 0);
          break;
        case 'G90':
          this.absolute = true;
          break;
        case 'G91':
          this.absolute = false;
          break;
        case 'G92':
          //this resets positioning, typically for extruder, probably won't need
          break;
        case 'M567': {
          for (let tokenIdx = 1; tokenIdx < tokens.length; tokenIdx++) {
            let token = tokens[tokenIdx];
            var finalColors = [1, 1, 1];
            switch (token[0]) {
              case 'E':
                this.extruderPercentage = token.substring(1).split(':');
                break;
            }
          }
          for (let extruderIdx = 0; extruderIdx < 4; extruderIdx++) {
            finalColors[0] -= (1 - this.extruderColors[extruderIdx].r) * this.extruderPercentage[extruderIdx];
            finalColors[1] -= (1 - this.extruderColors[extruderIdx].g) * this.extruderPercentage[extruderIdx];
            finalColors[2] -= (1 - this.extruderColors[extruderIdx].b) * this.extruderPercentage[extruderIdx];
          }
          this.currentColor = new BABYLON.Color4(finalColors[0], finalColors[1], finalColors[2], 0.1);
          break;
        }
      }
    } else {
      if (tokenString.startsWith('T')) {
        var extruder = Number(tokenString.substring(1)) % this.extruderCount; //For now map to extruders 0 - 4
        if (extruder < 0) extruder = 0; // Cover the case where someone sets a tool to a -1 value
        this.currentColor = this.extruderColors[extruder].clone();
      }
    }

    //break lines into manageable meshes at cost of extra draw calls
    if (this.lines.length >= this.meshBreakPoint) {
      //lets build the mesh
      this.createScene(this.scene);
      this.lineMeshIndex++;
    }
  }

  createScene(scene) {
    let that = this;
    let lastUpdate = Date.now();
    let meshIndex = this.lineMeshIndex;
    let runComplete = false;
    this.gcodeLineIndex.push(new Array());

    if (this.renderVersion === RenderMode.Line) {
      this.renderMode = 'Line Rendering';

      //Extrusion
      let lineArray = [];
      let colorArray = [];
      if (this.debug) {
        console.log(this.lines[0]);
      }
      for (var lineIdx = 0; lineIdx < this.lines.length; lineIdx++) {
        let line = this.lines[lineIdx];
        this.gcodeLineIndex[meshIndex].push(line.gcodeLineNumber);
        let data = line.getPoints(scene);
        if (this.lineVertexAlpha) {
          data.colors[0].a = 0.5;
          data.colors[1].a = 0.5;
        }
        lineArray.push(data.points);
        colorArray.push(data.colors);
      }

      let lineMesh = BABYLON.MeshBuilder.CreateLineSystem(
        'm ' + this.lineMeshIndex,
        {
          lines: lineArray,
          colors: colorArray,
          updatable: true,
          useVertexAlpha: this.lineVertexAlpha,
        },
        scene
      );

      lineArray = null;
      colorArray = null;

      lineMesh.isVisible = true;
      lineMesh.doNotSyncBoundingInfo = true;
      lineMesh.freezeWorldMatrix(); // prevents from re-computing the World Matrix each frame
      lineMesh.freezeNormals();
      lineMesh.markVerticesDataAsUpdatable(BABYLON.VertexBuffer.ColorKind);

      const lineSolidMat = new BABYLON.StandardMaterial('solidMaterial', scene);
      lineMesh.material = lineSolidMat;

      let lastRendered = 0;

      let beforeRenderFunc = function () {
        if (that.liveTracking && !runComplete && (that.gcodeLineNumber === 0 || lastRendered >= that.gcodeLineIndex[meshIndex].length - 1)) {
          return;
        } else if (Date.now() - lastUpdate < that.refreshTime) {
          return;
        } else {
          lastUpdate = Date.now();

          var colorData = lineMesh.getVerticesData(BABYLON.VertexBuffer.ColorKind);

          if (colorData === null || colorData === undefined) {
            console.log('Fail');
            return;
          }

          let renderTo = -1;
          for (var renderToIdx = lastRendered; renderToIdx < that.gcodeLineIndex[meshIndex].length; renderToIdx++) {
            if (that.gcodeLineIndex[meshIndex][renderToIdx] <= that.gcodeLineNumber) {
              renderTo = renderToIdx;
            }
          }

          for (var colorIdx = lastRendered; colorIdx < renderTo; colorIdx++) {
            let index = colorIdx * 8;
            colorData[index] = 1;
            colorData[index + 1] = 1;
            colorData[index + 2] = 1;
            colorData[index + 3] = 1;
            colorData[index + 4] = 1;
            colorData[index + 5] = 1;
            colorData[index + 6] = 1;
            colorData[index + 7] = 1;
          }
          lastRendered = renderTo;
          lineMesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, colorData, true);

          if (that.gcodeLineNumber === Number.MAX_VALUE) {
            runComplete = true;
          }
        }
      };

      this.renderFuncs.push(beforeRenderFunc);
      scene.registerBeforeRender(beforeRenderFunc);
    } else if (this.renderVersion === RenderMode.Block) {
      var layerHeight = Math.floor((this.currentLayerHeight - this.previousLayerHeight) * 100) / 100;

      if (this.spreadLines) {
        layerHeight /= this.spreadLineAmount;
      }

      this.renderMode = 'Mesh Rendering';
      var box = BABYLON.MeshBuilder.CreateBox('box', { width: 1, height: layerHeight, depth: layerHeight * 1.2 }, scene);

      let l = this.lines;

      this.gcodeLineIndex.push(new Array());

      let particleBuilder = function (particle, i, s) {
        l[s].renderLineV3(particle);
        that.gcodeLineIndex[meshIndex].push(particle.props.gcodeLineNumber);
      };

      let sps = new BABYLON.SolidParticleSystem('gcodemodel' + this.meshLineIndex, scene, {
        updatable: true,
        enableMultiMaterial: true,
      });

      sps.addShape(box, this.lines.length, {
        positionFunction: particleBuilder,
      });

      sps.buildMesh();

      //Build out solid and transparent material.
      const solidMat = new BABYLON.StandardMaterial('solidMaterial', scene);
      const transparentMat = new BABYLON.StandardMaterial('transparentMaterial', scene);
      transparentMat.alpha = this.materialTransparency;

      sps.setMultiMaterial([solidMat, transparentMat]);
      sps.setParticles();
      sps.computeSubMeshes();
      sps.mesh.freezeWorldMatrix(); // prevents from re-computing the World Matrix each frame
      sps.mesh.freezeNormals();
      sps.mesh.doNotSyncBoundingInfo = true;

      sps.updateParticle = function (particle) {
        if (that.gcodeLineIndex[meshIndex][particle.idx] < that.gcodeLineNumber) {
          particle.color = new BABYLON.Color4(1, 1, 1, 1);
          particle.materialIndex = 0;
        } else {
          particle.color = new BABYLON.Color4(particle.color.r, particle.color.g, particle.color.b, 0.5);
          particle.materialIndex = 1;
        }
      };

      let beforeRenderFunc = function () {
        if (that.liveTracking && !runComplete) {
          if (Date.now() - lastUpdate < that.refreshTime) {
            return;
          } else {
            lastUpdate = Date.now();
            sps.setParticles();
            sps.computeSubMeshes();
          }
          if (that.gcodeLineNumber === Number.MAX_VALUE) {
            runComplete = true;
          }
        }
      };

      this.renderFuncs.push(beforeRenderFunc);
      scene.registerBeforeRender(beforeRenderFunc);
      this.scene.clearCachedVertexData();
    } else if (this.renderVersion === RenderMode.Point) {
      //point cloud
      this.sps = new BABYLON.PointsCloudSystem('pcs' + this.meshLineIndex, 1, scene);

      let l = this.lines;

      let particleBuilder = function (particle, i, s) {
        l[s].renderParticle(particle);
      };

      this.sps.addPoints(this.lines.length, particleBuilder);

      this.sps.buildMeshAsync().then((mesh) => {
        mesh.material.pointSize = 2;
      });
    }

    if (this.renderTravels) {
      this.createTravelLines(scene);
    }

    this.lines = [];
    this.travels = [];

    this.scene.render();
  }

  createTravelLines(scene) {
    //Travels
    var travelArray = [];
    var travelColorArray = [];
    for (var travelIdx = 0; travelIdx < this.travels.length; travelIdx++) {
      let line = this.travels[travelIdx];
      let data = line.getPoints(scene);
      travelArray.push(data.points);
      travelColorArray.push(data.colors);
    }
    var travelMesh = BABYLON.MeshBuilder.CreateLineSystem(
      'travels',
      {
        lines: travelArray,
        colors: travelColorArray,
        updatable: false,
        useVertexAlpha: false,
      },
      scene
    );
    travelMesh.isVisible = false;
  }

  updatePercentComplete(percentComplete) {
    if (this.liveTracking) {
      this.gcodeLineNumber = Math.floor(this.lineCount * percentComplete);
    } else {
      this.gcodeLineNumber = 0;
    }
  }
  setLiveTracking(enabled) {
    if (this.liveTracking && enabled == false) {
      this.gcodeLineNumber = Number.MAX_VALUE;
    }
    this.liveTracking = enabled;
  }

  doFinalPass() {
    this.liveTracking = true;
    this.gcodeLineNumber = Number.MAX_VALUE;
    setTimeout(() => {
      this.liveTracking = false;
    }, this.refreshTime + 1000);
  }

  updateMesh() {
    if (this.renderVersion === 1) {
      console.log('Version 1');
    } else if (this.renderVersion === 2) {
      console.log('Version 2');
    }
  }
  unregisterEvents() {
    for (let idx = 0; idx < this.renderFuncs.length; idx++) {
      this.scene.unregisterBeforeRender(this.renderFuncs[idx]);
    }
    this.renderFuncs = [];
  }
}

window.mobilecheck = function () {
  var check = false;
  (function (a) {
    if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4))) check = true;
  })(navigator.userAgent || navigator.vendor || window.opera);
  return check;
};
