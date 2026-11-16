import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w') as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename.endswith('.opf'):
            s = data.decode('utf-8')
            s = s.replace('<dc:language></dc:language>', '<dc:language>sq</dc:language>').replace('xml:lang=""', 'xml:lang="sq"')
            data = s.encode('utf-8')
        if info.filename.endswith('.xhtml'):
            s = data.decode('utf-8')
            s = s.replace('xml:lang=""', 'xml:lang="sq"').replace(' lang=""', ' lang="sq"')
            data = s.encode('utf-8')
        ztype = zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED
        zout.writestr(zipfile.ZipInfo(info.filename, date_time=info.date_time), data, compress_type=ztype)
print('wrote', dst)
