# POSシステム（じゃがバター屋）

## 概要
文化祭で使用したリアルタイムPOSシステムです。
注文入力・厨房表示・レシート印刷を一体化しています。

## 機能
・注文入力（数量・トッピング）
・リアルタイム同期（Socket.IO）
・厨房画面
・注文ステータス管理
・SQLiteによるデータ保存
・LINE通知
・レシート印刷

## 技術スタック
・Node.js / Express
・Socket.IO
・SQLite
・HTML / CSS / JavaScript

## 起動方法
npm install
node server.js

## アクセス
http://localhost:8443

## ポイント
・リアルタイムで注文が厨房に反映される
・実際の文化祭で使用
・UIはタッチ操作を意識して設計
