import React, { useState, useEffect } from 'react';
import {
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
  Chip,
  Grid,
  Card,
  CardContent,
  Typography
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SettingsIcon from '@mui/icons-material/Settings';

function StreamManager() {
  const [streams, setStreams] = useState([]);
  const [inputStream, setInputStream] = useState({
    name: '',
    sourceUrl: '',
    outputUrl: 'rtmp://ali.push.yximgs.com/live/',
    key: '',
    videoCodec: 'copy',
    videoBitrate: '2000k',
    audioCodec: 'aac',
    audioBitrate: '128k'
  });
  
  const [openSettings, setOpenSettings] = useState(false);
  const [selectedStream, setSelectedStream] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [streamStatus, setStreamStatus] = useState({});

  // 定期检查流状态
  useEffect(() => {
    const interval = setInterval(() => {
      streams.forEach(stream => {
        fetch(`http://localhost:5000/api/streams/${stream.id}/status`)
          .then(res => res.json())
          .then(data => {
            setStreamStatus(prev => ({
              ...prev,
              [stream.id]: data
            }));
          });
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [streams]);

  const handleAdd = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/streams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...inputStream, id: Date.now() }),
      });
      
      const data = await response.json();
      if (data.status === 'success') {
        setStreams([...streams, { ...inputStream, id: Date.now() }]);
        setSnackbar({
          open: true,
          message: '推流添加成功',
          severity: 'success'
        });
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `推流添加失败: ${error.message}`,
        severity: 'error'
      });
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await fetch(`http://localhost:5000/api/streams/${id}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      if (data.status === 'success') {
        setStreams(streams.filter(stream => stream.id !== id));
        setSnackbar({
          open: true,
          message: '推流已停止',
          severity: 'success'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: '停止推流失败',
        severity: 'error'
      });
    }
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importedStreams = JSON.parse(e.target.result);
        const response = await fetch('http://localhost:5000/api/streams/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(importedStreams),
        });
        
        const data = await response.json();
        if (data.status === 'success') {
          setStreams([...streams, ...importedStreams]);
          setSnackbar({
            open: true,
            message: '配置导入成功',
            severity: 'success'
          });
        }
      } catch (error) {
        setSnackbar({
          open: true,
          message: '配置导入失败',
          severity: 'error'
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <Grid container spacing={2} style={{ marginBottom: 20 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                添加新推流
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={3}>
                  <TextField
                    fullWidth
                    label="流名称"
                    value={inputStream.name}
                    onChange={(e) => setInputStream({ ...inputStream, name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={3}>
                  <TextField
                    fullWidth
                    label="源地址"
                    value={inputStream.sourceUrl}
                    onChange={(e) => setInputStream({ ...inputStream, sourceUrl: e.target.value })}
                  />
                </Grid>
                <Grid item xs={3}>
                  <TextField
                    fullWidth
                    label="推流密钥"
                    value={inputStream.key}
                    onChange={(e) => setInputStream({ ...inputStream, key: e.target.value })}
                  />
                </Grid>
                <Grid item xs={3}>
                  <Button
                    variant="contained"
                    onClick={handleAdd}
                    startIcon={<PlayArrowIcon />}
                    fullWidth
                  >
                    添加推流
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>源地址</TableCell>
              <TableCell>输出地址</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>运行时间</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {streams.map((stream) => (
              <TableRow key={stream.id}>
                <TableCell>{stream.name}</TableCell>
                <TableCell>{stream.sourceUrl}</TableCell>
                <TableCell>{`${stream.outputUrl}${stream.key}`}</TableCell>
                <TableCell>
                  <Chip
                    label={streamStatus[stream.id]?.status || '未知'}
                    color={streamStatus[stream.id]?.status === 'running' ? 'success' : 'error'}
                  />
                </TableCell>
                <TableCell>{streamStatus[stream.id]?.uptime || '-'}</TableCell>
                <TableCell>
                  <IconButton onClick={() => handleDelete(stream.id)}>
                    <StopIcon color="error" />
                  </IconButton>
                  <IconButton onClick={() => {
                    setSelectedStream(stream);
                    setOpenSettings(true);
                  }}>
                    <SettingsIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Grid container spacing={2} style={{ marginTop: 20 }}>
        <Grid item>
          <Button
            variant="contained"
            component="label"
          >
            导入配置
            <input
              type="file"
              hidden
              accept=".json"
              onChange={handleImport}
            />
          </Button>
        </Grid>
        <Grid item>
          <Button 
            variant="contained" 
            onClick={() => {
              const exportData = JSON.stringify(streams, null, 2);
              const blob = new Blob([exportData], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'streams.json';
              a.click();
            }}
          >
            导出配置
          </Button>
        </Grid>
      </Grid>

      <Dialog open={openSettings} onClose={() => setOpenSettings(false)}>
        <DialogTitle>推流设置</DialogTitle>
        <DialogContent>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="视频编码器"
                value={selectedStream?.videoCodec || 'copy'}
                onChange={(e) => setSelectedStream({
                  ...selectedStream,
                  videoCodec: e.target.value
                })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="视频码率"
                value={selectedStream?.videoBitrate || '2000k'}
                onChange={(e) => setSelectedStream({
                  ...selectedStream,
                  videoBitrate: e.target.value
                })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="音频编码器"
                value={selectedStream?.audioCodec || 'aac'}
                onChange={(e) => setSelectedStream({
                  ...selectedStream,
                  audioCodec: e.target.value
                })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="音频码率"
                value={selectedStream?.audioBitrate || '128k'}
                onChange={(e) => setSelectedStream({
                  ...selectedStream,
                  audioBitrate: e.target.value
                })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenSettings(false)}>取消</Button>
          <Button onClick={() => {
            setStreams(streams.map(s => 
              s.id === selectedStream.id ? selectedStream : s
            ));
            setOpenSettings(false);
          }} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

export default StreamManager; 